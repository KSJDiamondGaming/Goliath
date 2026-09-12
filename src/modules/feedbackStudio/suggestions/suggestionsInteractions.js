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
const formatChannel = (id) => id ? `<#${id}>` : '⚠️ Not set';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length
  ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ')
  : 'Administrators / Manage Server only';

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

function workflowReadiness(section, enabled) {
  const reviewEnabled = section.requireReview !== false;
  const missing = [];
  if (!section.submitChannelId) missing.push('public suggestions channel');
  if (reviewEnabled && !section.reviewChannelId) missing.push('private team discussion channel');
  return {
    ready: enabled && missing.length === 0,
    missing,
    reviewEnabled,
  };
}

function buildOverviewPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  const readiness = workflowReadiness(section, enabled);
  const deployed = Boolean(section.deployment?.channelId && section.deployment?.messageId);
  const outcomesConfigured = [section.approvedChannelId, section.deniedChannelId].filter(Boolean).length;
  const managementRoles = Array.isArray(section.reviewerRoleIds) ? section.reviewerRoleIds.filter(Boolean) : [];

  const nextStep = !enabled
    ? '⚠️ Suggestions are disabled. Open **Settings** to enable the module.'
    : readiness.missing.length
      ? `⚠️ Complete the ${readiness.missing.join(' and ')} before publishing.`
      : deployed
        ? '✅ Core setup is complete. Use **Update Public Panel** after configuration changes.'
        : '✅ Core setup is complete. You can publish the member-facing panel.';

  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions · Control Centre')
    .setDescription('Set up and manage the suggestion workflow from one place. The important day-to-day controls stay here; global behaviour lives under **Settings**.')
    .addFields(
      {
        name: 'Current status',
        value: [
          `• Module: ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
          `• Public panel: ${deployed ? `✅ Published in ${formatChannel(section.deployment.channelId)}` : '⚪ Not published yet'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Core setup',
        value: [
          `1️⃣ Public suggestions: ${formatChannel(section.submitChannelId)}`,
          `2️⃣ Team discussion: ${readiness.reviewEnabled ? formatChannel(section.reviewChannelId) : '⏸️ Not used while review is disabled'}`,
          `3️⃣ Management team: ${managementRoles.length ? formatRoles(managementRoles) : 'Administrators / Manage Server only'}`,
          `4️⃣ Outcomes: ${outcomesConfigured}/2 channels set · Audit log: ${section.logChannelId ? '✅ Set' : '⚠️ Not set'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Suggestion activity',
        value: [
          `💡 Submitted **${section.analytics.submitted}**   ·   💬 Discussing **${section.analytics.discussing}**`,
          `✅ Approved **${section.analytics.approved}**   ·   🚀 Implemented **${section.analytics.implemented}**   ·   ❌ Declined **${section.analytics.denied}**`,
        ].join('\n'),
        inline: false,
      },
      { name: 'Next step', value: nextStep, inline: false },
    )
    .setFooter({ text: `Suggestions management · Opened by ${memberName}` })
    .setTimestamp();

  const publishButton = button(
    'admin:suggestions:deploy',
    deployed ? '🔄 Update Public Panel' : '🚀 Publish Public Panel',
    ButtonStyle.Success,
  ).setDisabled(!readiness.ready);

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:submitChannel')
        .setPlaceholder('1 · Choose public suggestions channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)),
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:reviewChannel')
        .setPlaceholder(readiness.reviewEnabled ? '2 · Choose private team discussion channel' : '2 · Team discussion is currently disabled')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)
        .setDisabled(!readiness.reviewEnabled)),
      row(
        button('admin:suggestions:reviewers', '👥 Management Team', ButtonStyle.Primary),
        button('admin:suggestions:destinations', '📬 Outcomes & Logs', ButtonStyle.Primary),
        button('admin:suggestions:settings', '⚙️ Settings', ButtonStyle.Secondary),
      ),
      row(publishButton),
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
    .setDescription('These settings control how Suggestions behaves across the whole server. The buttons below describe the action they will perform.')
    .addFields(
      {
        name: 'Module',
        value: `Suggestions are currently **${enabled ? 'Enabled ✅' : 'Disabled ❌'}**.\n${enabled ? 'Members can use the published panel and active suggestion controls.' : 'New submissions and active controls are paused.'}`,
        inline: false,
      },
      {
        name: 'Community voting',
        value: voting ? '✅ Enabled · Open suggestions can receive community votes.' : '❌ Disabled · Vote controls are hidden globally.',
        inline: true,
      },
      {
        name: 'Management review',
        value: review ? '✅ Enabled · Suggestions use the managed review workflow.' : '❌ Disabled · Private review workflow is bypassed.',
        inline: true,
      },
      {
        name: 'Public identity',
        value: anonymous
          ? '🔒 Anonymous · Public suggestion cards hide the member name. Management can still identify the submitter.'
          : '👤 Named · Public suggestion cards show the submitting member.',
        inline: false,
      },
    )
    .setFooter({ text: `Global Suggestions settings · Opened by ${memberName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(button(
        enabled ? 'admin:suggestions:disable' : 'admin:suggestions:enable',
        enabled ? '⏸️ Disable Suggestions' : '▶️ Enable Suggestions',
        enabled ? ButtonStyle.Danger : ButtonStyle.Success,
      )),
      row(
        button('admin:suggestions:toggleVoting', voting ? '⏸️ Disable Voting' : '▶️ Enable Voting', voting ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:suggestions:toggleReview', review ? '⏸️ Disable Review' : '▶️ Enable Review', review ? ButtonStyle.Secondary : ButtonStyle.Success),
      ),
      row(button(
        'admin:suggestions:toggleAnonymous',
        anonymous ? '👤 Show Member Names Publicly' : '🔒 Make Public Suggestions Anonymous',
        ButtonStyle.Secondary,
      )),
      row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary)),
    ],
  };
}

function buildManagementTeamPanel(guild, memberName, page = 0) {
  const section = suggestions.getSection(guild.id);
  const pageCount = panelNavigation.rolePickerPageCount(guild);
  const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
  const picker = panelNavigation.buildRolePicker(guild, {
    customId: 'admin:suggestions:reviewerRoles',
    placeholder: 'Choose management roles',
    selectedIds: section.reviewerRoleIds,
    minValues: 0,
    maxValues: 25,
    page: safePage,
    pagination: true,
    showManaged: true,
  });

  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions · Management Team')
    .setDescription('Choose the roles that can move suggestions through discussion, approval, decline and implementation.')
    .addFields(
      {
        name: 'Selected management roles',
        value: formatRoles(section.reviewerRoleIds),
        inline: false,
      },
      {
        name: 'Role list',
        value: `Roles are ordered **highest → lowest** in the server hierarchy. Page **${safePage + 1} of ${pageCount}**.${pageCount > 1 ? ' Use Previous / Next to view every role.' : ''}`,
        inline: false,
      },
      {
        name: 'Built-in access',
        value: 'Members with **Administrator** or **Manage Server** can always manage suggestions, even if no role is selected here.',
        inline: false,
      },
    )
    .setFooter({ text: `Management access · Opened by ${memberName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      ...picker.rows,
      row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary)),
    ],
  };
}

function buildDestinationsPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions · Outcomes & Logs')
    .setDescription('Choose where final results and the management audit trail are posted. The original public suggestion is always updated with its final status and team response.')
    .addFields(
      {
        name: '✅ Approved suggestions',
        value: section.approvedChannelId ? formatChannel(section.approvedChannelId) : 'Optional · no separate approved-results channel selected',
        inline: false,
      },
      {
        name: '❌ Declined suggestions',
        value: section.deniedChannelId ? formatChannel(section.deniedChannelId) : 'Optional · no separate declined-results channel selected',
        inline: false,
      },
      {
        name: '🧾 Audit log',
        value: section.logChannelId ? `${formatChannel(section.logChannelId)} · Management actions are recorded here.` : '⚠️ Not set · recommended so management actions have a permanent channel record.',
        inline: false,
      },
    )
    .setFooter({ text: `Outcome routing · Opened by ${memberName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:approvedChannel')
        .setPlaceholder('Approved suggestions channel · optional')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)),
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:deniedChannel')
        .setPlaceholder('Declined suggestions channel · optional')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)),
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:logChannel')
        .setPlaceholder('Suggestions audit log channel · recommended')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)),
      row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary)),
    ],
  };
}

function buildAdminPanel(guild, memberName, page = 'overview', rolePage = 0) {
  if (page === 'settings') return buildSettingsPanel(guild, memberName);
  if (page === 'reviewers') return buildManagementTeamPanel(guild, memberName, rolePage);
  if (page === 'destinations') return buildDestinationsPanel(guild, memberName);
  return buildOverviewPanel(guild, memberName);
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
        return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'reviewers', rolePicker.page));
      }
      if (rolePicker.kind === 'page' && interaction.isButton?.()) {
        return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'reviewers', rolePicker.page));
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
      save((section) => ({ ...section, voting: section.voting === false }));
      await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleReview') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, requireReview: section.requireReview === false }));
      await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true });
      return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleAnonymous') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, anonymous: section.anonymous !== true }));
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
          ? `✅ **${saved.title}** was shared anonymously. You can follow its progress from **My Suggestions**.`
          : `✅ **${saved.title}** was shared. You can follow its progress from **My Suggestions**.`,
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
