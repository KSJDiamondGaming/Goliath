'use strict';

const {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const suggestions = require('./suggestions');
const panel = require('./suggestionsPanel');
const tracking = require('./suggestionsTracking');
const panelNavigation = require('../../../core/ui/panelNavigation');
const { setModuleEnabled, isModuleEnabled } = require('../../../core/guild/guildManager');

const SUGGESTIONS_COLOR = panel.SUGGESTIONS_COLOR || 0xfee75c;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const formatChannel = (id) => id ? `<#${id}>` : '*Not set*';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '*None selected*';

async function safeReply(interaction, content) {
  const text = String(content || 'That suggestion action could not be completed.').slice(0, 1900);
  const payload = { content: text, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.replied) return await interaction.followUp(payload);
    if (interaction.deferred) {
      if (interaction.isMessageComponent?.()) return await interaction.followUp(payload);
      return await interaction.editReply({ content: text });
    }
    return await interaction.reply(payload);
  } catch (error) {
    console.error('[Suggestions] Failed to respond to interaction:', error);
    return null;
  }
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

function withoutReplyFlags(payload = {}) {
  const { flags, ephemeral, ...rest } = payload;
  return rest;
}

async function refreshLiveSuggestionUi(guild, { panelMessage = false, suggestionMessages = false } = {}) {
  if (panelMessage) await panel.refreshDeployedPanel(guild).catch((error) => {
    console.warn('[Suggestions] Could not refresh the published suggestions panel:', error.message || error);
  });
  if (suggestionMessages) await tracking.refreshPendingSuggestions(guild, panel).catch((error) => {
    console.warn('[Suggestions] Could not refresh active suggestion messages:', error.message || error);
  });
}

async function refreshManagementRoleCache(guild) {
  if (!guild?.roles?.fetch) throw new Error('The server role list could not be loaded.');
  try {
    await guild.roles.fetch();
  } catch (error) {
    throw new Error(`The complete server role list could not be loaded: ${error.message || 'Please try again.'}`);
  }
}

function buildOverviewPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions')
    .setDescription([
      'Set up where suggestions go and who manages them. Use **Settings** for module-wide behaviour.', '',
      `**Status:** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`, '',
      '**Channels**',
      `• Public suggestions: ${formatChannel(section.submitChannelId)}`,
      `• Team discussion: ${formatChannel(section.reviewChannelId)}`,
      `• Audit log: ${formatChannel(section.logChannelId)}`, '',
      '**Management team**',
      `• ${formatRoles(section.reviewerRoleIds)}`, '',
      '**Activity**',
      `• ${section.analytics.submitted} submitted · ${section.analytics.discussing} discussing · ${section.analytics.approved} approved`,
      `• ${section.analytics.implemented} implemented · ${section.analytics.denied} declined`,
    ].join('\n'))
    .setFooter({ text: `Opened by ${memberName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:submitChannel').setPlaceholder('Public suggestions channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:reviewChannel').setPlaceholder('Private team discussion channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(
        button('admin:suggestions:reviewers', '👥 Management Team', ButtonStyle.Primary),
        button('admin:suggestions:destinations', '📬 Outcomes & Logs', ButtonStyle.Primary),
        button('admin:suggestions:settings', '⚙️ Settings', ButtonStyle.Secondary),
      ),
      row(button('admin:suggestions:deploy', '🚀 Publish Panel', ButtonStyle.Success)),
      row(button('admin:modules', '⬅️ Back to Modules', ButtonStyle.Secondary)),
    ],
  };
}

function buildSettingsPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  const voting = section.voting !== false;
  const review = section.requireReview !== false;
  const anonymous = section.anonymous === true;

  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions · Settings')
    .setDescription([
      'Control how the Suggestions module behaves across the server.', '',
      '**Module**',
      `• Suggestions: ${enabled ? '✅ Enabled' : '❌ Disabled'}`, '',
      '**Community**',
      `• Community voting: ${voting ? '✅ Enabled' : '❌ Disabled'}`,
      `• Public identity: ${anonymous ? '🔒 Anonymous' : '👤 Named'}`, '',
      '**Management workflow**',
      `• Management review: ${review ? '✅ Enabled' : '❌ Disabled'}`, '',
      '*These are global settings. Changes apply to the Suggestions module across this server.*',
    ].join('\n'))
    .setFooter({ text: `Opened by ${memberName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(button(enabled ? 'admin:suggestions:disable' : 'admin:suggestions:enable', enabled ? '⏸️ Disable Suggestions' : '▶️ Enable Suggestions', enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      row(
        button('admin:suggestions:toggleVoting', voting ? '⏸️ Disable Voting' : '▶️ Enable Voting', voting ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:suggestions:toggleReview', review ? '⏸️ Disable Review' : '▶️ Enable Review', review ? ButtonStyle.Secondary : ButtonStyle.Success),
      ),
      row(button('admin:suggestions:toggleAnonymous', anonymous ? '👤 Show Member Names' : '🔒 Make Suggestions Anonymous', ButtonStyle.Secondary)),
      row(button('admin:suggestions:overview', '⬅️ Back to Suggestions', ButtonStyle.Secondary)),
    ],
  };
}

function buildAdminPanel(guild, memberName, page = 'overview') {
  if (page === 'overview') return buildOverviewPanel(guild, memberName);
  if (page === 'settings') return buildSettingsPanel(guild, memberName);
  return panel.buildSuggestionsAdminPanel(guild, memberName, page);
}

async function handleSuggestionsAdminInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:suggestions')) return false;
  if (!interaction.guild?.id) {
    await safeReply(interaction, '❌ Suggestions can only be managed inside a server.');
    return true;
  }

  const memberName = interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
  const save = (updater) => suggestions.updateSection(interaction.guild.id, updater, interaction.guild);

  try {
    const rolePicker = panelNavigation.parseRolePickerId(id);
    if (rolePicker?.baseId === 'admin:suggestions:reviewerRoles') {
      await refreshManagementRoleCache(interaction.guild);

      if (rolePicker.kind === 'select' && interaction.isStringSelectMenu?.()) {
        const section = suggestions.getSection(interaction.guild.id);
        const reviewerRoleIds = panelNavigation.mergeRolePickerSelection(
          interaction.guild,
          section.reviewerRoleIds,
          interaction.values || [],
          rolePicker.page,
        );
        save((current) => ({ ...current, reviewerRoleIds }));
        return safeUpdate(interaction, panel.buildReviewerRolesPanel(interaction.guild, memberName, rolePicker.page));
      }
      if (rolePicker.kind === 'page' && interaction.isButton?.()) {
        return safeUpdate(interaction, panel.buildReviewerRolesPanel(interaction.guild, memberName, rolePicker.page));
      }
    }

    if (id === 'admin:suggestions' || id === 'admin:suggestions:overview') {
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'overview'));
    }
    if (id === 'admin:suggestions:settings') {
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    }
    if (id === 'admin:suggestions:reviewers') {
      await refreshManagementRoleCache(interaction.guild);
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'reviewers'));
    }
    if (id === 'admin:suggestions:destinations') {
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'destinations'));
    }

    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const property = id.split(':')[2];
      if (['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'logChannel'].includes(property)) {
        save((section) => ({ ...section, [`${property}Id`]: value }));
        const page = ['approvedChannel', 'deniedChannel', 'logChannel'].includes(property) ? 'destinations' : 'overview';
        return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, page));
      }
    } else if (id === 'admin:suggestions:enable') {
      await interaction.deferUpdate();
      setModuleEnabled(interaction.guild.id, 'suggestions', true, interaction.guild);
      await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true, suggestionMessages: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:disable') {
      await interaction.deferUpdate();
      setModuleEnabled(interaction.guild.id, 'suggestions', false, interaction.guild);
      await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true, suggestionMessages: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleVoting') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, voting: !section.voting }));
      await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleReview') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, requireReview: !section.requireReview }));
      await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleAnonymous') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, anonymous: !section.anonymous }));
      await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:deploy') {
      await interaction.deferUpdate();
      await panel.deploySubmitPanel(interaction.guild);
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'overview'));
    }

    return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'overview'));
  } catch (error) {
    console.error('[Suggestions] Admin interaction failed:', error);
    await safeReply(interaction, `❌ Suggestions could not be updated: ${error.message || 'Please try again.'}`);
    return true;
  }
}

async function handleSuggestionsInteraction(interaction) {
  if (!interaction?.guildId || !String(interaction.customId || '').startsWith('suggestions:')) return false;

  try {
    const parts = String(interaction.customId || '').split(':');

    if (interaction.isButton?.() && interaction.customId === 'suggestions:submit') {
      tracking.assertEnabled(interaction.guildId);
      await interaction.showModal(panel.buildSubmitModal());
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'mine' && parts[2] === 'page') {
      const payload = panel.buildMySuggestionsPayload(interaction.guildId, interaction.user.id, Number(parts[3] || 0));
      if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) await interaction.update(withoutReplyFlags(payload));
      else await interaction.reply(payload);
      return true;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId === 'suggestions:mine:select') {
      const [suggestionId, page = '0'] = String(interaction.values?.[0] || '').split('|');
      await interaction.update(withoutReplyFlags(panel.buildMySuggestionDetail(interaction.guildId, interaction.user.id, suggestionId, Number(page || 0))));
      return true;
    }

    if (interaction.isButton?.() && interaction.customId === 'suggestions:mine:close') {
      await interaction.deferUpdate();
      await interaction.deleteReply().catch(() => null);
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === 'suggestions:modal:submit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const saved = await tracking.submitSuggestion(interaction, panel);
      await interaction.editReply({
        content: saved.anonymous === true
          ? `✅ **${saved.title}** has been shared anonymously and sent to the management workflow.`
          : `✅ **${saved.title}** has been shared and sent to the management workflow.`,
      });
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'vote') {
      if (!suggestions.cleanSuggestionId(parts[2]) || !['up', 'down'].includes(parts[3])) throw new Error('That vote is no longer available.');
      await interaction.deferUpdate();
      await tracking.vote(interaction, parts[2], parts[3], panel);
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'manage') {
      const suggestionId = suggestions.cleanSuggestionId(parts[2]);
      const action = parts[3];
      if (!suggestionId || !['discuss', 'resume', 'approve', 'deny', 'implemented'].includes(action)) {
        throw new Error('That management action is no longer available.');
      }
      const section = tracking.assertEnabled(interaction.guildId);
      if (!tracking.isReviewer(interaction.member, section)) throw new Error('Only the suggestions management team can use these controls.');

      if (['approve', 'deny', 'implemented'].includes(action)) {
        await interaction.showModal(panel.buildReviewModal(suggestionId, action));
        return true;
      }

      await interaction.deferUpdate();
      const updated = await tracking.manage(interaction, suggestionId, action, panel);
      await interaction.followUp({
        content: action === 'discuss'
          ? `💬 ${updated.reference} is now under team discussion. Community voting has been paused.`
          : `▶️ ${updated.reference} is open for community voting again.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'reviewOpen') {
      const suggestionId = suggestions.cleanSuggestionId(parts[2]);
      if (!suggestionId) throw new Error('That review option is no longer available.');
      const section = tracking.assertEnabled(interaction.guildId);
      if (!tracking.isReviewer(interaction.member, section)) throw new Error('Only the suggestions management team can use this button.');
      const current = suggestions.getSuggestion(interaction.guildId, suggestionId);
      if (!current) throw new Error('That suggestion could not be found.');
      await interaction.reply(panel.buildReviewerDecisionPayload(interaction.guild, suggestionId));
      return true;
    }

    if (interaction.isButton?.() && interaction.customId === 'suggestions:reviewClose') {
      await interaction.deferUpdate();
      await interaction.deleteReply().catch(() => null);
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'review') {
      if (!suggestions.cleanSuggestionId(parts[2]) || !['approve', 'deny'].includes(parts[3])) throw new Error('That review action is no longer available.');
      const section = tracking.assertEnabled(interaction.guildId);
      if (!tracking.isReviewer(interaction.member, section)) throw new Error('You are not part of the suggestions management team.');
      await interaction.showModal(panel.buildReviewModal(parts[2], parts[3]));
      return true;
    }

    if (interaction.isModalSubmit?.() && parts[1] === 'reviewModal') {
      const suggestionId = suggestions.cleanSuggestionId(parts[2]);
      const action = parts[3];
      if (!suggestionId || !['approve', 'deny', 'implemented'].includes(action)) throw new Error('That management action is no longer available.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();
      const updated = await tracking.manage(interaction, suggestionId, action, panel, reason);
      const messages = {
        approve: `✅ ${updated.reference} has been approved. Voting is closed and the action was logged.`,
        deny: `❌ ${updated.reference} has been declined. The reason is visible on the original suggestion and the action was logged.`,
        implemented: `🚀 ${updated.reference} has been marked as implemented. The original suggestion and audit log have been updated.`,
      };
      await interaction.editReply({ content: messages[action] });
      return true;
    }

    return false;
  } catch (error) {
    console.error('[Suggestions] Interaction failed:', error);
    await safeReply(interaction, `❌ ${error.message || 'That suggestion action could not be completed.'}`);
    return true;
  }
}

module.exports = { handleSuggestionsAdminInteraction, handleSuggestionsInteraction };
