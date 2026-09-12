'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const stats = require('./stats');

const PANEL_COLOR = 0x5865F2;
const TYPE_LABELS = Object.freeze({
  channels: ['📁', 'Channels'],
  countdown: ['⏳', 'Countdown / Timer'],
  datetime: ['📅', 'Date & Time'],
  members: ['👥', 'Members'],
  status: ['🟢', 'Members with Status'],
  role: ['🎭', 'Members in Role'],
  roles: ['🏷️', 'Roles'],
  voice: ['🔊', 'Members in Voice'],
  messages: ['💬', 'Message Count'],
  voiceMinutes: ['🎙️', 'Voice Minutes'],
  joins: ['📥', 'Member Joins'],
  leaves: ['📤', 'Member Leaves'],
  boosts: ['🚀', 'Server Boosts'],
  emojis: ['😀', 'Emojis'],
});

function button(customId, label, style = ButtonStyle.Primary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function select(customId, placeholder, options) {
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options.slice(0, 25));
}

function memberName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Management';
}

function summaryText(docks) {
  if (!docks.length) return 'No counters are set up yet. Use **Quick Setup** or **Create Counter** below.';
  return docks.slice(0, 12).map((dock) => {
    const status = dock.enabled ? '🟢' : '⚫';
    const types = dock.segments.map((segment) => TYPE_LABELS[segment.type]?.[1] || segment.type).join(' + ');
    return `${status} **${dock.name || 'Counter'}** — ${types}${dock.channelId ? ` — <#${dock.channelId}>` : ''}`;
  }).join('\n');
}

function buildStatsAdminPanel(guild, displayName = 'Management') {
  const summary = stats.getSummary(guild.id);
  const docks = stats.counters.listCounters(guild.id);
  const active = docks.filter((dock) => dock.enabled).length;

  const embed = new EmbedBuilder()
    .setColor(summary.enabled ? 0x57F287 : PANEL_COLOR)
    .setTitle('📊 Server Counters')
    .setDescription([
      'Create live counter channels for members, statuses, roles, voice, date/time and more.',
      '',
      `**Stats:** ${summary.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Counters:** ${active} active · ${docks.length} saved`,
    ].join('\n'))
    .addFields({ name: 'Your Counters', value: summaryText(docks).slice(0, 1024) })
    .setFooter({ text: `Opened by ${displayName}` })
    .setTimestamp();

  const typeOptions = Object.entries(TYPE_LABELS).map(([value, [emoji, label]]) => ({
    label,
    value,
    emoji,
    description: value === 'status' ? 'Online, idle, DND or offline members' : value === 'role' ? 'Count members who have selected roles' : `Create a ${label.toLowerCase()} counter`,
  }));

  const components = [
    row(
      button('admin:stats:setup', '⚡ Quick Setup', ButtonStyle.Success),
      button('admin:stats:refresh', '🔄 Refresh', ButtonStyle.Primary),
      button(summary.enabled ? 'admin:stats:disable' : 'admin:stats:enable', summary.enabled ? '⏸️ Disable Stats' : '▶️ Enable Stats', summary.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
    ),
    row(select('admin:stats:create', '➕ Create a counter…', typeOptions)),
  ];

  if (docks.length) {
    components.push(row(select('admin:stats:manage', '⚙️ Manage an existing counter…', docks.map((dock) => ({
      label: String(dock.name || 'Counter').slice(0, 100),
      value: dock.id,
      description: `${dock.enabled ? 'Active' : 'Off'} · ${dock.segments.map((segment) => TYPE_LABELS[segment.type]?.[1] || segment.type).join(' + ')}`.slice(0, 100),
    })))));
  }

  components.push(row(button('admin:studio:utilityStudio', '⬅️ Back', ButtonStyle.Secondary)));
  return { embeds: [embed], components };
}

function buildManagePanel(guild, dock, displayName = 'Management') {
  const types = dock.segments.map((segment) => `${TYPE_LABELS[segment.type]?.[0] || '•'} ${TYPE_LABELS[segment.type]?.[1] || segment.type}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(dock.enabled ? 0x57F287 : 0x6B7280)
    .setTitle(`⚙️ ${dock.name || 'Counter'}`)
    .setDescription(dock.channelId ? `Counter channel: <#${dock.channelId}>` : 'This counter is saved but currently turned off.')
    .addFields(
      { name: 'Status', value: dock.enabled ? '🟢 On' : '⚫ Off', inline: true },
      { name: 'Updates', value: `Every ${dock.frequencyMinutes} minutes`, inline: true },
      { name: 'Counters inside', value: types || 'None', inline: false },
      { name: 'Channel text', value: `\`${dock.template}\``, inline: false },
      { name: 'More editing', value: 'Use the Goliath dashboard to change roles, statuses, timezone, countdowns, goals, channel filters or combine up to four counters.', inline: false }
    )
    .setFooter({ text: `Opened by ${displayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button(`admin:stats:toggle:${dock.id}`, dock.enabled ? '⏸️ Turn Off' : '▶️ Turn On', dock.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`admin:stats:delete:${dock.id}`, '🗑️ Delete', ButtonStyle.Danger),
        button('admin:stats', '⬅️ Back', ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildDeleteConfirmation(dock) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🗑️ Delete Counter?')
      .setDescription(`This will permanently remove **${dock.name || 'Counter'}** and its Discord counter channel.\n\nThis cannot be undone.`)],
    components: [row(
      button(`admin:stats:delete-confirm:${dock.id}`, 'Delete Counter', ButtonStyle.Danger),
      button(`admin:stats:open:${dock.id}`, 'Cancel', ButtonStyle.Secondary)
    )],
  };
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

async function handleStatsAdminInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:stats')) return false;
  const displayName = memberName(interaction);

  if (id === 'admin:stats') return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));

  if (interaction.isStringSelectMenu?.() && id === 'admin:stats:create') {
    await interaction.deferUpdate().catch(() => null);
    const type = interaction.values?.[0];
    const [emoji, label] = TYPE_LABELS[type] || ['📊', 'Counter'];
    stats.setEnabled(interaction.guild.id, true, interaction.guild);
    const dock = await stats.counters.createDock(interaction.guild, {
      name: label,
      template: `${emoji} ${label}: {value}`,
      segments: [{ type, options: type === 'status' ? { statuses: ['online'] } : {} }],
      source: 'panel',
    }, interaction.guild);
    return safeUpdate(interaction, buildManagePanel(interaction.guild, dock, displayName));
  }

  if (interaction.isStringSelectMenu?.() && id === 'admin:stats:manage') {
    const dock = stats.counters.listCounters(interaction.guild.id).find((item) => item.id === interaction.values?.[0]);
    if (!dock) return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
    return safeUpdate(interaction, buildManagePanel(interaction.guild, dock, displayName));
  }

  if (!interaction.isButton?.()) return false;

  if (id === 'admin:stats:setup') {
    await interaction.deferUpdate().catch(() => null);
    stats.setEnabled(interaction.guild.id, true, interaction.guild);
    await stats.counters.createCounterSuite(interaction.guild);
    return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
  }

  if (id === 'admin:stats:refresh') {
    await interaction.deferUpdate().catch(() => null);
    await stats.counters.refreshCounters(interaction.guild);
    return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
  }

  if (id === 'admin:stats:enable' || id === 'admin:stats:disable') {
    stats.setEnabled(interaction.guild.id, id.endsWith(':enable'), interaction.guild);
    return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:open:')) {
    const dockId = id.slice('admin:stats:open:'.length);
    const dock = stats.counters.listCounters(interaction.guild.id).find((item) => item.id === dockId);
    return safeUpdate(interaction, dock ? buildManagePanel(interaction.guild, dock, displayName) : buildStatsAdminPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:toggle:')) {
    await interaction.deferUpdate().catch(() => null);
    const dockId = id.slice('admin:stats:toggle:'.length);
    const dock = stats.counters.listCounters(interaction.guild.id).find((item) => item.id === dockId);
    if (!dock) return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
    const updated = await stats.counters.setDockEnabled(interaction.guild, dock.id, !dock.enabled, interaction.guild);
    return safeUpdate(interaction, buildManagePanel(interaction.guild, updated, displayName));
  }

  if (id.startsWith('admin:stats:delete-confirm:')) {
    await interaction.deferUpdate().catch(() => null);
    const dockId = id.slice('admin:stats:delete-confirm:'.length);
    await stats.counters.deleteDock(interaction.guild, dockId, interaction.guild);
    return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:delete:')) {
    const dockId = id.slice('admin:stats:delete:'.length);
    const dock = stats.counters.listCounters(interaction.guild.id).find((item) => item.id === dockId);
    return safeUpdate(interaction, dock ? buildDeleteConfirmation(dock) : buildStatsAdminPanel(interaction.guild, displayName));
  }

  return false;
}

module.exports = { buildStatsAdminPanel, handleStatsAdminInteraction };
