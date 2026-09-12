'use strict';

const { MessageFlags, Routes } = require('discord.js');
const suggestions = require('./suggestions');
const panel = require('./suggestionsPanel');
const tracking = require('./suggestionsTracking');
const panelNavigation = require('../../../core/ui/panelNavigation');
const { setModuleEnabled } = require('../../../core/guild/guildManager');

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
  if (!guild?.client?.rest || !guild?.roles) throw new Error('The server role list could not be loaded.');

  let rawRoles;
  try {
    rawRoles = await guild.client.rest.get(Routes.guildRoles(guild.id));
  } catch (error) {
    throw new Error(`The complete server role list could not be loaded from Discord: ${error.message || 'Please try again.'}`);
  }

  if (!Array.isArray(rawRoles) || !rawRoles.length) throw new Error('Discord returned an empty server role list.');
  if (typeof guild.roles._add !== 'function') throw new Error('The server role manager could not prepare the role list.');

  for (const rawRole of rawRoles) guild.roles._add(rawRole, true);

  const loaded = rawRoles.filter((role) => String(role?.id || '') !== String(guild.id));
  if (!loaded.length) throw new Error('Discord did not return any selectable server roles.');

  return loaded;
}

function buildManagementRolePanelPayload(guild, memberName, page = 0, loadedCount = null) {
  const pageCount = panelNavigation.rolePickerPageCount(guild);
  const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
  const payload = panel.buildReviewerRolesPanel(guild, memberName, safePage);
  const count = Number.isFinite(Number(loadedCount))
    ? Number(loadedCount)
    : panelNavigation.guildRolesByHierarchy(guild).length;

  return {
    ...payload,
    content: `🔎 Roles loaded: **${count}** · Page **${safePage + 1}/${pageCount}**`,
  };
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
      const loadedRoles = await refreshManagementRoleCache(interaction.guild);

      if (rolePicker.kind === 'select' && interaction.isStringSelectMenu?.()) {
        const section = suggestions.getSection(interaction.guild.id);
        const reviewerRoleIds = panelNavigation.mergeRolePickerSelection(
          interaction.guild,
          section.reviewerRoleIds,
          interaction.values || [],
          rolePicker.page,
        );
        save((current) => ({ ...current, reviewerRoleIds }));
        return safeUpdate(
          interaction,
          buildManagementRolePanelPayload(interaction.guild, memberName, rolePicker.page, loadedRoles.length),
        );
      }
      if (rolePicker.kind === 'page' && interaction.isButton?.()) {
        return safeUpdate(
          interaction,
          buildManagementRolePanelPayload(interaction.guild, memberName, rolePicker.page, loadedRoles.length),
        );
      }
    }

    if (id === 'admin:suggestions' || id === 'admin:suggestions:overview') {
      return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, 'overview'));
    }
    if (id === 'admin:suggestions:reviewers') {
      const loadedRoles = await refreshManagementRoleCache(interaction.guild);
      return safeUpdate(
        interaction,
        buildManagementRolePanelPayload(interaction.guild, memberName, 0, loadedRoles.length),
      );
    }
    if (id === 'admin:suggestions:destinations') {
      return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, 'destinations'));
    }

    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const property = id.split(':')[2];
      if (['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'logChannel'].includes(property)) {
        save((section) => ({ ...section, [`${property}Id`]: value }));
        const page = ['approvedChannel', 'deniedChannel', 'logChannel'].includes(property) ? 'destinations' : 'overview';
        return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, page));
      }
    } else if (id === 'admin:suggestions:enable') {
      await interaction.deferUpdate();
      setModuleEnabled(interaction.guild.id, 'suggestions', true, interaction.guild);
      await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true, suggestionMessages: true });
    } else if (id === 'admin:suggestions:disable') {
      await interaction.deferUpdate();
      setModuleEnabled(interaction.guild.id, 'suggestions', false, interaction.guild);
      await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true, suggestionMessages: true });
    } else if (id === 'admin:suggestions:toggleVoting') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, voting: !section.voting }));
      await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true });
    } else if (id === 'admin:suggestions:toggleReview') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, requireReview: !section.requireReview }));
      await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true });
    } else if (id === 'admin:suggestions:toggleAnonymous') {
      await interaction.deferUpdate();
      save((section) => ({ ...section, anonymous: !section.anonymous }));
      await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true });
    } else if (id === 'admin:suggestions:deploy') {
      await interaction.deferUpdate();
      await panel.deploySubmitPanel(interaction.guild);
    }

    return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, 'overview'));
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
