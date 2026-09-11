'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const suggestions = require('./suggestions');
const tracking = require('./suggestionsTracking');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const panelNavigation = require('../../../core/ui/panelNavigation');

const SUGGESTIONS_COLOR = 0xfee75c;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const formatChannel = (id) => id ? `<#${id}>` : '*Not set*';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '*None selected*';
const statusEmoji = (status) => status === 'approved' ? '✅' : status === 'denied' ? '❌' : '💡';
const statusLabel = (status) => status === 'approved' ? 'Approved' : status === 'denied' ? 'Declined' : 'Pending';

function compactPreview(content, maxLength = 80) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function shortDate(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown date';
}

function buildSuggestionEmbed(guild, suggestion, section) {
  const fields = [];
  if (suggestion.anonymous === true) fields.push({ name: 'Shared by', value: 'Anonymous member', inline: true });
  else if (suggestion.authorId) fields.push({ name: 'Shared by', value: `<@${suggestion.authorId}>`, inline: true });
  fields.push(
    { name: 'Status', value: `${statusEmoji(suggestion.status)} ${statusLabel(suggestion.status)}`, inline: true },
    { name: 'Community vote', value: `👍 ${suggestion.upVotes.length}   👎 ${suggestion.downVotes.length}`, inline: true },
  );
  if (suggestion.status !== 'pending' && suggestion.reviewReason) {
    fields.push({ name: 'Team response', value: suggestion.reviewReason, inline: false });
  }

  const title = suggestion.status === 'approved'
    ? '💡 Suggestion Approved'
    : suggestion.status === 'denied'
      ? '💡 Suggestion Declined'
      : '💡 New Suggestion';
  const footer = suggestion.status === 'pending'
    ? (section.voting !== false ? 'Use the buttons below to have your say.' : 'Thanks for sharing an idea with the community.')
    : 'Thanks for helping improve the community.';

  return new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle(title)
    .setDescription(suggestion.content || '_No suggestion text was provided._')
    .addFields(fields)
    .setFooter({ text: footer })
    .setTimestamp(new Date(suggestion.createdAt || Date.now()));
}

function buildSuggestionRows(suggestion, section) {
  const rows = [];
  if (section.voting !== false && suggestion.status === 'pending') {
    rows.push(row(
      button(`suggestions:vote:${suggestion.suggestionId}:up`, `👍 ${suggestion.upVotes.length}`, ButtonStyle.Secondary),
      button(`suggestions:vote:${suggestion.suggestionId}:down`, `👎 ${suggestion.downVotes.length}`, ButtonStyle.Secondary),
    ));
  }
  if (section.requireReview !== false && suggestion.status === 'pending') {
    rows.push(row(
      button(`suggestions:review:${suggestion.suggestionId}:approve`, 'Approve', ButtonStyle.Success),
      button(`suggestions:review:${suggestion.suggestionId}:deny`, 'Decline', ButtonStyle.Danger),
    ));
  }
  return rows;
}

function buildSubmitPanelPayload(guildId) {
  const section = tracking.assertEnabled(guildId);
  const privacyNote = section.anonymous === true
    ? '\n\n🔒 **Anonymous mode is on.** Your name will be hidden when your suggestion is posted.'
    : '';
  return {
    embeds: [new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle('💡 Suggestions')
      .setDescription(`Have an idea that could make the server better? Share it with the team here.\n\nUse **My Suggestions** to check what you have sent and see any team response.${privacyNote}`)
      .setFooter({ text: 'Thanks for helping improve the community.' })
      .setTimestamp()],
    components: [row(
      button('suggestions:submit', section.anonymous ? 'Share Anonymously' : 'Share a Suggestion'),
      button('suggestions:mine:page:0', 'My Suggestions', ButtonStyle.Secondary),
    )],
  };
}

function memberSuggestions(guildId, userId) {
  return Object.values(suggestions.getSection(guildId).suggestions || {})
    .filter((item) => String(item.authorId || '') === String(userId || ''))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function buildMySuggestionsPayload(guildId, userId, page = 0) {
  const records = memberSuggestions(guildId, userId);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const pageRecords = records.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const counts = records.reduce((out, item) => {
    out[item.status] = Number(out[item.status] || 0) + 1;
    return out;
  }, { pending: 0, approved: 0, denied: 0 });
  const lines = pageRecords.length
    ? pageRecords.map((item) => `${statusEmoji(item.status)} **${statusLabel(item.status)}** · ${shortDate(item.createdAt)}\n${compactPreview(item.content, 120)}`)
    : ['You have not shared any suggestions yet.'];
  const components = [];

  if (pageRecords.length) {
    components.push(row(new StringSelectMenuBuilder()
      .setCustomId('suggestions:mine:select')
      .setPlaceholder('Choose a suggestion to open')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(pageRecords.map((item) => ({
        label: `${statusEmoji(item.status)} ${statusLabel(item.status)} · ${compactPreview(item.content, 60) || 'Suggestion'}`.slice(0, 100),
        description: `Shared ${shortDate(item.createdAt)}`.slice(0, 100),
        value: `${item.suggestionId}|${safePage}`,
      })))));
  }

  components.push(row(
    button(`suggestions:mine:page:${Math.max(0, safePage - 1)}`, 'Previous', ButtonStyle.Secondary).setDisabled(safePage === 0),
    button(`suggestions:mine:page:${Math.min(totalPages - 1, safePage + 1)}`, 'Next', ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    button('suggestions:mine:close', 'Close', ButtonStyle.Secondary),
  ));

  return {
    embeds: [new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle('💡 My Suggestions')
      .setDescription([
        `Waiting for review: **${counts.pending}** · Approved: **${counts.approved}** · Declined: **${counts.denied}**`,
        '',
        ...lines,
        '',
        `Page **${safePage + 1} of ${totalPages}** · **${records.length}** total`,
      ].join('\n'))
      .setFooter({ text: 'Only you can see this.' })
      .setTimestamp()],
    components,
    flags: MessageFlags.Ephemeral,
  };
}

function buildMySuggestionDetail(guildId, userId, suggestionId, page = 0) {
  const item = suggestions.getSuggestion(guildId, suggestionId);
  if (!item || String(item.authorId || '') !== String(userId || '')) throw new Error('That suggestion could not be found in your history.');
  const reviewed = item.reviewedAt ? `<t:${Math.floor(new Date(item.reviewedAt).getTime() / 1000)}:F>` : 'Waiting for review';
  return {
    embeds: [new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle(`💡 My Suggestion · ${statusLabel(item.status)}`)
      .setDescription(item.content || '_No suggestion text was provided._')
      .addFields(
        { name: 'Status', value: `${statusEmoji(item.status)} ${statusLabel(item.status)}`, inline: true },
        { name: 'Community vote', value: `👍 ${item.upVotes.length}   👎 ${item.downVotes.length}`, inline: true },
        { name: 'Reviewed', value: reviewed, inline: false },
        ...(item.reviewReason ? [{ name: 'Team response', value: item.reviewReason, inline: false }] : []),
      )
      .setFooter({ text: 'Only you can see this.' })
      .setTimestamp(new Date(item.updatedAt || item.createdAt || Date.now()))],
    components: [row(
      button(`suggestions:mine:page:${Math.max(0, Number(page) || 0)}`, '⬅️ My Suggestions', ButtonStyle.Secondary),
      button('suggestions:mine:close', 'Close', ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

function buildSubmitModal() {
  return new ModalBuilder()
    .setCustomId('suggestions:modal:submit')
    .setTitle('Share a Suggestion')
    .addComponents(row(
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('What would you like to suggest?')
        .setPlaceholder('Tell us your idea and how it could help the server.')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(5)
        .setMaxLength(1800)
        .setRequired(true),
    ));
}

function buildReviewModal(suggestionId, action) {
  const approve = action === 'approve';
  return new ModalBuilder()
    .setCustomId(`suggestions:reviewModal:${suggestionId}:${approve ? 'approve' : 'deny'}`)
    .setTitle(approve ? 'Approve Suggestion' : 'Decline Suggestion')
    .addComponents(row(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Message to the member (optional)')
        .setPlaceholder(approve ? 'Let them know what happens next.' : 'Explain the decision if you would like to.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(false),
    ));
}

function overviewDescription(section, enabled) {
  return [
    'Choose where members send ideas, who can review them, and how suggestions work for your community.',
    '',
    `**Suggestions:** ${enabled ? 'On ✅' : 'Off ❌'}`,
    '',
    '**Channels**',
    `• Member suggestions: ${formatChannel(section.submitChannelId)}`,
    `• Team review: ${formatChannel(section.reviewChannelId)}`,
    '',
    '**Review team**',
    `• ${formatRoles(section.reviewerRoleIds)}`,
    '',
    '**Member options**',
    `• Community voting: ${section.voting !== false ? 'On ✅' : 'Off ❌'}`,
    `• Team review before decision: ${section.requireReview !== false ? 'On ✅' : 'Off ❌'}`,
    `• Hide member names: ${section.anonymous === true ? 'On ✅' : 'Off ❌'}`,
    '',
    '**Activity**',
    `• ${section.analytics.submitted} shared · ${section.analytics.approved} approved · ${section.analytics.denied} declined`,
  ].join('\n');
}

function buildReviewerRolesPanel(guild, memberDisplayName = 'Unknown User', page = 0) {
  const section = suggestions.getSection(guild.id);
  const picker = panelNavigation.buildRolePicker(guild, {
    customId: 'admin:suggestions:reviewerRoles',
    placeholder: 'Choose reviewer roles',
    selectedIds: section.reviewerRoleIds,
    minValues: 0,
    maxValues: 25,
    page,
    pagination: true,
    showManaged: true,
  });

  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions · Review Team')
    .setDescription([
      'Choose which roles can approve or decline suggestions.',
      '',
      'Roles are shown from **highest to lowest** in the server hierarchy. You can select roles across multiple pages.',
      '',
      `**Selected roles:** ${formatRoles(section.reviewerRoleIds)}`,
      '',
      'Members with **Manage Server** or **Administrator** can always review suggestions.',
    ].join('\n'))
    .setFooter({ text: `Opened by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      ...picker.rows,
      row(button('admin:suggestions:overview', '⬅️ Back to Suggestions', ButtonStyle.Secondary)),
    ],
  };
}

function buildSuggestionsAdminPanel(guild, memberDisplayName = 'Unknown User', page = 'overview') {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');

  if (page === 'reviewers') return buildReviewerRolesPanel(guild, memberDisplayName, 0);

  if (page === 'destinations') {
    const embed = new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle('💡 Suggestions · Decision Channels')
      .setDescription([
        'You can optionally post the final result of a suggestion into separate channels.',
        '',
        `**Approved suggestions:** ${formatChannel(section.approvedChannelId)}`,
        `**Declined suggestions:** ${formatChannel(section.deniedChannelId)}`,
        '',
        'Leave either one unset if you only want the original suggestion message updated.',
      ].join('\n'))
      .setFooter({ text: `Opened by ${memberDisplayName}` })
      .setTimestamp();
    return { embeds: [embed], components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:approvedChannel').setPlaceholder('Approved suggestions channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:deniedChannel').setPlaceholder('Declined suggestions channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(button('admin:suggestions:overview', '⬅️ Back to Suggestions', ButtonStyle.Secondary)),
    ] };
  }

  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions')
    .setDescription(overviewDescription(section, enabled))
    .setFooter({ text: `Opened by ${memberDisplayName}` })
    .setTimestamp();

  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:submitChannel').setPlaceholder('Where members send suggestions').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:reviewChannel').setPlaceholder('Where the team reviews suggestions').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(
      button('admin:suggestions:reviewers', '👥 Review Team', ButtonStyle.Primary),
      button('admin:suggestions:destinations', '📬 Decision Channels', ButtonStyle.Primary),
    ),
    row(
      button('admin:suggestions:deploy', '🚀 Publish Panel', ButtonStyle.Success),
      button(enabled ? 'admin:suggestions:disable' : 'admin:suggestions:enable', enabled ? '⏸️ Turn Off' : '▶️ Turn On', ButtonStyle.Secondary),
      button('admin:suggestions:toggleVoting', section.voting !== false ? '🗳️ Voting On' : '🗳️ Voting Off', ButtonStyle.Secondary),
      button('admin:suggestions:toggleReview', section.requireReview !== false ? '🔎 Review On' : '🔎 Review Off', ButtonStyle.Secondary),
      button('admin:suggestions:toggleAnonymous', section.anonymous === true ? '👤 Names Hidden' : '👤 Names Shown', ButtonStyle.Secondary),
    ),
    row(button('admin:modules', '⬅️ Back to Modules', ButtonStyle.Secondary)),
  ] };
}

async function fetchDeploymentMessage(guild, deployment) {
  if (!deployment?.channelId || !deployment?.messageId) return null;
  const channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(deployment.messageId).catch(() => null);
}

async function deploySubmitPanel(guild) {
  const section = tracking.assertEnabled(guild?.id);
  if (!section.submitChannelId) throw new Error('Choose where members should send suggestions first.');

  const channel = await tracking.resolveSendableChannel(guild, section.submitChannelId, 'suggestions channel', { requireHistory: true });
  const payload = buildSubmitPanelPayload(guild.id);
  const existing = await fetchDeploymentMessage(guild, section.deployment);

  if (existing?.editable && existing.channelId === channel.id) {
    await existing.edit(payload);
    suggestions.saveDeployment(guild.id, {
      channelId: existing.channelId,
      messageId: existing.id,
      deployedAt: section.deployment.deployedAt || suggestions.now(),
    }, guild);
    return existing;
  }

  const message = await channel.send(payload);
  try {
    suggestions.saveDeployment(guild.id, {
      channelId: message.channelId,
      messageId: message.id,
      deployedAt: suggestions.now(),
    }, guild);
  } catch (error) {
    await message.delete().catch(() => null);
    throw error;
  }

  if (existing?.deletable && existing.id !== message.id) await existing.delete().catch(() => null);
  return message;
}

module.exports = {
  SUGGESTIONS_COLOR,
  buildSuggestionEmbed,
  buildSuggestionRows,
  buildSubmitPanelPayload,
  buildMySuggestionsPayload,
  buildMySuggestionDetail,
  buildSubmitModal,
  buildReviewModal,
  buildReviewerRolesPanel,
  buildSuggestionsAdminPanel,
  deploySubmitPanel,
};
