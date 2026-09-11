'use strict';

const { PermissionFlagsBits } = require('discord.js');
const suggestions = require('./suggestions');
const emojis = require('../../utilityStudio/emojis/emojis');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const locks = new Map();
const lockKey = (guildId, suggestionId) => `${guildId}:${suggestionId}`;

async function withSuggestionLock(guildId, suggestionId, operation) {
  const key = lockKey(guildId, suggestionId);
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

function assertEnabled(guildId) {
  if (!guildId || !isModuleEnabled(guildId, 'suggestions')) throw new Error('Suggestions are disabled for this server.');
  return suggestions.getSection(guildId);
}

function isReviewer(member, section) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return (section.reviewerRoleIds || []).some((roleId) => member.roles?.cache?.has(roleId));
}

async function resolveSendableChannel(guild, channelId, label, options = {}) {
  if (!guild || !channelId) throw new Error(`${label} is not configured.`);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error(`${label} is unavailable or not sendable.`);
  const permissions = guild.members.me && channel.permissionsFor?.(guild.members.me);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (options.requireHistory === true) required.push(PermissionFlagsBits.ReadMessageHistory);
  if (permissions && !required.every((permission) => permissions.has(permission))) {
    throw new Error(`Goliath lacks permission to use the ${label.toLowerCase()}.`);
  }
  return channel;
}

async function resolveSuggestionPayload(guild, payload = {}) {
  return emojiPayload.resolveMessagePayload(guild.client, guild.id, payload, 'suggestions');
}

async function submitSuggestion(interaction, panel) {
  const guildId = interaction?.guildId;
  if (!interaction?.guild || !interaction.user?.id) throw new Error('Server or member is unavailable.');
  assertEnabled(guildId);

  const content = String(interaction.fields.getTextInputValue('content') || '').trim();
  if (content.length < 5 || content.length > 1800) throw new Error('Suggestion must be between 5 and 1800 characters.');

  let suggestionId = suggestions.createId('sg');
  while (suggestions.getSuggestion(guildId, suggestionId)) suggestionId = suggestions.createId('sg');

  return withSuggestionLock(guildId, suggestionId, async () => {
    const fresh = assertEnabled(guildId);
    const draft = suggestions.normalizeSuggestion({
      suggestionId,
      content,
      authorId: interaction.user.id,
      anonymous: fresh.anonymous === true,
    });
    const targetId = fresh.requireReview !== false ? fresh.reviewChannelId || fresh.submitChannelId : fresh.submitChannelId;
    const channel = await resolveSendableChannel(interaction.guild, targetId, 'Suggestion channel', { requireHistory: true });
    const payload = await resolveSuggestionPayload(interaction.guild, {
      embeds: [panel.buildSuggestionEmbed(interaction.guild, draft, fresh)],
      components: panel.buildSuggestionRows(draft, fresh),
    });
    const message = await channel.send(payload);

    try {
      return suggestions.saveSuggestion(guildId, {
        ...draft,
        channelId: message.channelId,
        messageId: message.id,
        reviewMessageId: fresh.requireReview !== false ? message.id : null,
      }, interaction.guild);
    } catch (error) {
      await message.delete().catch(() => null);
      throw error;
    }
  });
}

async function refreshSuggestionMessage(guild, suggestionId, panel) {
  if (!guild?.id) return null;
  const section = suggestions.getSection(guild.id);
  const suggestion = suggestions.getSuggestion(guild.id, suggestionId);
  if (!suggestion?.channelId || !suggestion.messageId) return null;
  const channel = guild.channels.cache.get(suggestion.channelId) || await guild.channels.fetch(suggestion.channelId).catch(() => null);
  const message = await channel?.messages?.fetch(suggestion.messageId).catch(() => null);
  if (!message?.editable) return null;
  const payload = await resolveSuggestionPayload(guild, {
    embeds: [panel.buildSuggestionEmbed(guild, suggestion, section)],
    components: panel.buildSuggestionRows(suggestion, section),
  });
  await message.edit(payload);
  return suggestion;
}

async function bestEffortRefresh(guild, suggestionId, panel) {
  try { return await refreshSuggestionMessage(guild, suggestionId, panel); }
  catch (error) {
    console.warn(`[Suggestions] Failed to refresh suggestion ${suggestionId}:`, error.message || error);
    return null;
  }
}

async function vote(interaction, suggestionId, direction, panel) {
  if (!['up', 'down'].includes(direction)) throw new Error('Invalid vote direction.');
  const guildId = interaction?.guildId;
  const userId = interaction?.user?.id;
  const id = suggestions.cleanSuggestionId(suggestionId);
  if (!guildId || !userId || !id) throw new Error('Invalid suggestion vote.');

  return withSuggestionLock(guildId, id, async () => {
    const section = assertEnabled(guildId);
    if (section.voting === false) throw new Error('Voting is disabled.');
    const current = suggestions.getSuggestion(guildId, id);
    if (!current) throw new Error('Suggestion not found.');
    if (current.status !== 'pending') throw new Error('Voting is closed for this suggestion.');

    const updated = suggestions.updateSuggestion(guildId, id, (item) => {
      const upVotes = new Set(item.upVotes || []);
      const downVotes = new Set(item.downVotes || []);
      if (direction === 'up') {
        downVotes.delete(userId);
        if (upVotes.has(userId)) upVotes.delete(userId);
        else upVotes.add(userId);
      } else {
        upVotes.delete(userId);
        if (downVotes.has(userId)) downVotes.delete(userId);
        else downVotes.add(userId);
      }
      return { ...item, upVotes: [...upVotes], downVotes: [...downVotes] };
    }, interaction.guild);

    if (!updated) throw new Error('Suggestion could not be updated.');
    await bestEffortRefresh(interaction.guild, id, panel);
    return updated;
  });
}

async function notifyAuthor(guild, suggestion) {
  if (!guild || !suggestion?.authorId) return false;
  const member = await guild.members.fetch(suggestion.authorId).catch(() => null);
  if (!member?.user) return false;
  const verdict = suggestion.status === 'approved' ? 'approved ✅' : 'denied ❌';
  const note = suggestion.reviewReason ? `\nDecision note: ${suggestion.reviewReason}` : '';
  const content = await emojis.resolveText(
    guild.client,
    guild.id,
    `Your suggestion in **${guild.name}** was **${verdict}**.${note}\nSuggestion ID: \`${suggestion.suggestionId}\``,
  );
  return member.user.send(content).then(() => true).catch(() => false);
}

async function publishReviewedSuggestion(guild, targetId, label, updated, section, panel) {
  if (!targetId) return true;
  try {
    const target = await resolveSendableChannel(guild, targetId, label);
    const payload = await resolveSuggestionPayload(guild, {
      embeds: [panel.buildSuggestionEmbed(guild, updated, section)],
    });
    await target.send(payload);
    return true;
  } catch (error) {
    console.warn(`[Suggestions] Failed to publish ${updated.suggestionId} to ${label}:`, error.message || error);
    return false;
  }
}

async function review(interaction, suggestionId, action, panel, reason = '') {
  if (!['approve', 'deny'].includes(action)) throw new Error('Invalid review action.');
  const guildId = interaction?.guildId;
  const reviewerId = interaction?.user?.id;
  const id = suggestions.cleanSuggestionId(suggestionId);
  if (!guildId || !interaction?.guild || !reviewerId || !id) throw new Error('Invalid suggestion review.');

  return withSuggestionLock(guildId, id, async () => {
    const section = assertEnabled(guildId);
    if (!isReviewer(interaction.member, section)) throw new Error('You do not have permission to review suggestions.');
    const current = suggestions.getSuggestion(guildId, id);
    if (!current) throw new Error('Suggestion not found.');
    if (current.status !== 'pending') throw new Error(`Suggestion is already ${current.status}.`);

    const status = action === 'approve' ? 'approved' : 'denied';
    const reviewReason = String(reason || '').trim().slice(0, 500);
    const updated = suggestions.updateSuggestion(guildId, id, {
      status,
      reviewedBy: reviewerId,
      reviewedAt: new Date().toISOString(),
      reviewReason,
    }, interaction.guild);
    if (!updated) throw new Error('Suggestion could not be updated.');

    await bestEffortRefresh(interaction.guild, id, panel);

    const targetId = status === 'approved' ? section.approvedChannelId : section.deniedChannelId;
    await publishReviewedSuggestion(
      interaction.guild,
      targetId,
      `${status} suggestions channel`,
      updated,
      section,
      panel,
    );
    await notifyAuthor(interaction.guild, updated);
    return updated;
  });
}

module.exports = {
  assertEnabled,
  isReviewer,
  resolveSendableChannel,
  submitSuggestion,
  refreshSuggestionMessage,
  vote,
  review,
  notifyAuthor,
};
