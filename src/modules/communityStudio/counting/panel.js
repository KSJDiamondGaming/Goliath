'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const counting = require('./counting');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

const PREFIX = 'admin:module:counting';
const PANEL_COLOR = 0x5865f2;

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder()
  .setCustomId(customId)
  .setLabel(label)
  .setStyle(style);
const displayName = (interaction) => interaction.member?.displayName
  || interaction.user?.displayName
  || interaction.user?.username
  || 'Unknown User';

function formatOptional(value, emptyLabel) {
  return value === null || value === undefined || value === '' ? emptyLabel : String(value);
}

function buildPanel(guild, memberDisplayName = 'Unknown User') {
  const section = counting.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, counting.MODULE_KEY);
  const next = counting.expectedNext(section);
  const channel = section.channelId ? `<#${section.channelId}>` : '`Not set`';
  const lastCounter = section.lastCounterId ? `<@${section.lastCounterId}>` : '`Nobody yet`';

  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x57f287 : PANEL_COLOR)
    .setTitle('🔢 Counting')
    .setDescription([
      'Keep one channel in numerical order while Goliath deals with the questionable maths.',
      '',
      `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Counting Channel:** ${channel}`,
      '',
      `**Current Count:** \`${section.currentCount}\``,
      `**Next Number:** \`${next}\``,
      `**Highest Count:** \`${section.highestCount}\``,
      `**Last Counter:** ${lastCounter}`,
      `**Failed Attempts:** \`${section.failureStreak}\``,
      '',
      `**Starting Number:** \`${section.startingNumber}\``,
      `**Maximum Consecutive Counts:** \`${formatOptional(section.maxConsecutivePerMember, 'Unlimited')}\``,
      `**Reveal Answer After:** \`${formatOptional(section.answerAfterFailures, 'Disabled')}\` failed attempt(s)`,
      `**Delete Incorrect Messages:** ${section.deleteIncorrect ? 'Yes ✅' : 'No ❌'}`,
      `**Funny Responses:** ${section.funnyResponses ? 'On ✅' : 'Off ❌'}`,
      `**Response Cleanup:** \`${formatOptional(section.responseCleanupSeconds, 'Never')}\`${section.responseCleanupSeconds === null ? '' : ' seconds'}`,
      `**Milestones:** ${section.milestoneAnnouncements ? `On ✅ · every ${section.milestoneInterval}` : 'Off ❌'}`,
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    content: null,
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}:channel`)
        .setPlaceholder('Choose the counting channel')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1)),
      row(
        button(`${PREFIX}:toggle:enabled`, enabled ? '⏸️ Disable' : '▶️ Enable', enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:toggle:delete`, section.deleteIncorrect ? '🗑️ Delete: On' : '🗑️ Delete: Off', ButtonStyle.Secondary),
        button(`${PREFIX}:toggle:funny`, section.funnyResponses ? '😂 Jokes: On' : '😂 Jokes: Off', ButtonStyle.Secondary),
        button(`${PREFIX}:toggle:milestones`, section.milestoneAnnouncements ? '🎉 Milestones: On' : '🎉 Milestones: Off', ButtonStyle.Secondary),
      ),
      row(
        button(`${PREFIX}:rules`, '⚙️ Rules & Timing', ButtonStyle.Primary),
        button(`${PREFIX}:setCurrent`, '🎯 Set Current Count', ButtonStyle.Secondary),
        button(`${PREFIX}:reset`, '♻️ Reset Progress', ButtonStyle.Danger),
      ),
      row(button('admin:studio:communityStudio', '⬅️ Back', ButtonStyle.Secondary)),
    ],
  };
}

function textInput(customId, label, value, { required = false, placeholder = null } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required);
  if (value !== null && value !== undefined && value !== '') input.setValue(String(value));
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}

function buildRulesModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:rules:save`)
    .setTitle('Counting Rules & Timing')
    .addComponents(
      row(textInput('startingNumber', 'Starting number', section.startingNumber, { required: true, placeholder: '1' })),
      row(textInput('maxConsecutive', 'Maximum consecutive counts', section.maxConsecutivePerMember, { placeholder: 'Blank = unlimited' })),
      row(textInput('answerAfter', 'Reveal answer after failed attempts', section.answerAfterFailures, { placeholder: 'Blank = never reveal' })),
      row(textInput('cleanupSeconds', 'Delete bot responses after seconds', section.responseCleanupSeconds, { placeholder: 'Blank = keep responses' })),
      row(textInput('milestoneInterval', 'Milestone interval', section.milestoneInterval, { required: true, placeholder: '100' })),
    );
}

function buildSetCurrentModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:setCurrent:save`)
    .setTitle('Set Current Count')
    .addComponents(
      row(textInput('currentCount', 'Current count', section.currentCount, { required: true, placeholder: '0' })),
    );
}

function buildResetConfirmation() {
  return {
    content: '⚠️ Reset counting progress? This clears the current/highest count, last counter, failed attempts and member counting stats. Your rules and channel stay unchanged.',
    embeds: [],
    components: [
      row(
        button(`${PREFIX}:reset:confirm`, 'Yes, Reset Progress', ButtonStyle.Danger),
        button(`${PREFIX}:main:0`, 'Cancel', ButtonStyle.Secondary),
      ),
    ],
  };
}

function parseRequiredInteger(interaction, fieldId, label, min = 0) {
  const raw = interaction.fields.getTextInputValue(fieldId).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${label} must be ${min} or higher.`);
  return value;
}

function parseOptionalPositiveInteger(interaction, fieldId, label) {
  const raw = interaction.fields.getTextInputValue(fieldId).trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number or left blank.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be 1 or higher, or left blank.`);
  return value;
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

async function handleInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;
  const name = displayName(interaction);
  const actorId = interaction.user?.id || null;

  try {
    if (id === `${PREFIX}:main:0`) {
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (interaction.isChannelSelectMenu?.() && id === `${PREFIX}:channel`) {
      const channelId = interaction.values?.[0] || null;
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, channelId }), {
        actorId,
        action: 'counting_channel_changed',
      });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:toggle:enabled`) {
      setModuleEnabled(interaction.guild.id, counting.MODULE_KEY, !isModuleEnabled(interaction.guild.id, counting.MODULE_KEY), {
        actorId,
        action: 'counting_toggle_enabled',
      });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:toggle:delete`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, deleteIncorrect: !section.deleteIncorrect }), { actorId, action: 'counting_toggle_delete' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:toggle:funny`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, funnyResponses: !section.funnyResponses }), { actorId, action: 'counting_toggle_funny' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:toggle:milestones`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, milestoneAnnouncements: !section.milestoneAnnouncements }), { actorId, action: 'counting_toggle_milestones' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:rules`) {
      await interaction.showModal(buildRulesModal(interaction.guild.id));
      return true;
    }

    if (interaction.isModalSubmit?.() && id === `${PREFIX}:rules:save`) {
      const old = counting.getSection(interaction.guild.id);
      const startingNumber = parseRequiredInteger(interaction, 'startingNumber', 'Starting number', 0);
      const maxConsecutivePerMember = parseOptionalPositiveInteger(interaction, 'maxConsecutive', 'Maximum consecutive counts');
      const answerAfterFailures = parseOptionalPositiveInteger(interaction, 'answerAfter', 'Reveal-answer threshold');
      const responseCleanupSeconds = parseOptionalPositiveInteger(interaction, 'cleanupSeconds', 'Response cleanup time');
      const milestoneInterval = parseRequiredInteger(interaction, 'milestoneInterval', 'Milestone interval', 1);
      const hasProgress = old.currentCount >= old.startingNumber
        || Object.values(old.memberStats || {}).some((stats) => Number(stats?.validCounts || 0) > 0);

      counting.updateSection(interaction.guild.id, (section) => ({
        ...section,
        startingNumber,
        maxConsecutivePerMember,
        answerAfterFailures,
        responseCleanupSeconds,
        milestoneInterval,
        ...(!hasProgress ? {
          currentCount: startingNumber - 1,
          highestCount: startingNumber - 1,
          lastCounterId: null,
          consecutiveCount: 0,
          failureStreak: 0,
        } : {}),
      }), { actorId, action: 'counting_rules_saved' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:setCurrent`) {
      await interaction.showModal(buildSetCurrentModal(interaction.guild.id));
      return true;
    }

    if (interaction.isModalSubmit?.() && id === `${PREFIX}:setCurrent:save`) {
      const currentCount = parseRequiredInteger(interaction, 'currentCount', 'Current count', 0);
      counting.setCurrentCount(interaction.guild.id, currentCount, { actorId, action: 'counting_set_current' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:reset`) return safeUpdate(interaction, buildResetConfirmation());

    if (id === `${PREFIX}:reset:confirm`) {
      counting.resetProgress(interaction.guild.id, { actorId, action: 'counting_reset_progress' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    return safeUpdate(interaction, buildPanel(interaction.guild, name));
  } catch (error) {
    const payload = { content: `❌ Counting setup failed: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildPanel,
  buildRulesModal,
  buildSetCurrentModal,
  buildResetConfirmation,
  handleInteraction,
};
