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
const STATUS_LABELS = Object.freeze({
  online: ['🟢', 'Online'],
  idle: ['🟡', 'Idle'],
  dnd: ['🔴', 'Do Not Disturb'],
  offline: ['⚫', 'Offline'],
});

function button(customId, label, style = ButtonStyle.Primary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function select(customId, placeholder, options, minValues = 1, maxValues = 1) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(minValues)
    .setMaxValues(Math.max(minValues, Math.min(maxValues, options.length || 1)))
    .addOptions(options.slice(0, 25));
}

function memberName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Management';
}

function defaultSegment(type) {
  if (type === 'members') return { type, options: { humans: true, bots: true } };
  if (type === 'status') return { type, options: { statuses: ['online'] } };
  if (type === 'role') return { type, options: { roleIds: [], statuses: [] } };
  if (type === 'voice') return { type, options: { mode: 'all', channelIds: [] } };
  if (type === 'channels') return { type, options: { channelTypes: ['text', 'voice', 'category'] } };
  if (type === 'roles') return { type, options: { unmanaged: true, managed: false } };
  if (type === 'datetime') return { type, options: { format: 'weekday-short', timeZone: 'Europe/London' } };
  if (type === 'countdown') return { type, options: { timestamp: Date.now() + 86400000, includeDays: true, includeHours: true, includeMinutes: true, endText: 'Countdown complete!' } };
  return { type, options: {} };
}

function typeOptions(selected = null) {
  return Object.entries(TYPE_LABELS).map(([value, [emoji, label]]) => ({
    label,
    value,
    emoji,
    default: value === selected,
    description: value === 'status'
      ? 'Online, idle, DND or offline members'
      : value === 'role'
        ? 'Count members who have selected roles'
        : `Show ${label.toLowerCase()}`,
  }));
}

function findDock(guildId, dockId) {
  return stats.counters.listCounters(guildId).find((item) => item.id === dockId || item.channelId === dockId) || null;
}

function roleName(guild, roleIds = []) {
  if (roleIds.length !== 1) return 'Roles';
  return guild.roles.cache.get(roleIds[0])?.name || 'Role';
}

function segmentTemplate(guild, segment, placeholder) {
  const type = segment.type;
  const options = segment.options || {};
  if (type === 'datetime') return `📅 ${placeholder}`;
  if (type === 'countdown') return `⏳ ${placeholder}`;
  if (type === 'status') {
    const statuses = Array.isArray(options.statuses) ? options.statuses : [];
    if (statuses.length === 1 && STATUS_LABELS[statuses[0]]) {
      const [emoji, label] = STATUS_LABELS[statuses[0]];
      return `${emoji} ${label}: ${placeholder}`;
    }
    return `🟢 Status: ${placeholder}`;
  }
  if (type === 'role') return `🎭 ${roleName(guild, options.roleIds || [])}: ${placeholder}`;
  const [emoji, label] = TYPE_LABELS[type] || ['📊', 'Counter'];
  return `${emoji} ${label}: ${placeholder}`;
}

function generatedTemplate(guild, segments) {
  return segments.map((segment, index) => segmentTemplate(guild, segment, `{${index + 1}}`)).join(' • ').slice(0, 100);
}

function generatedName(segments) {
  if (segments.length > 1) return 'Combined Counter';
  return TYPE_LABELS[segments[0]?.type]?.[1] || 'Counter';
}

function summaryText(docks) {
  if (!docks.length) return 'No counters are set up yet. Use **Quick Setup** or **Create Counter** below.';
  return docks.slice(0, 12).map((dock) => {
    const status = dock.enabled ? '🟢' : '⚫';
    const output = dock.channelType === 'text' ? '#️⃣' : '🔊';
    const types = dock.segments.map((segment) => TYPE_LABELS[segment.type]?.[1] || segment.type).join(' + ');
    return `${status} ${output} **${dock.name || 'Counter'}** — ${types}${dock.channelId ? ` — <#${dock.channelId}>` : ''}`;
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

  const components = [
    row(
      button('admin:stats:setup', '⚡ Quick Setup', ButtonStyle.Success),
      button('admin:stats:refresh', '🔄 Refresh', ButtonStyle.Primary),
      button(summary.enabled ? 'admin:stats:disable' : 'admin:stats:enable', summary.enabled ? '⏸️ Disable Stats' : '▶️ Enable Stats', summary.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
    ),
    row(select('admin:stats:create', '➕ Create a counter…', typeOptions())),
    row(button('admin:stats:manager', '⚙️ Manage Counters', ButtonStyle.Primary, !docks.length)),
    row(button('admin:studio:utilityStudio', '⬅️ Back', ButtonStyle.Secondary)),
  ];

  return { embeds: [embed], components };
}

function buildCounterManagerPanel(guild, displayName = 'Management') {
  const docks = stats.counters.listCounters(guild.id);
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('⚙️ Manage Server Counters')
    .setDescription(docks.length
      ? 'Choose a counter below to **edit it, add more values, change its channel type, disable it or delete it**.'
      : 'There are no saved counters to manage yet.')
    .addFields({ name: 'Saved Counters', value: summaryText(docks).slice(0, 1024) })
    .setFooter({ text: `Opened by ${displayName}` })
    .setTimestamp();

  const components = [];
  if (docks.length) {
    components.push(row(select('admin:stats:manage', 'Choose a counter to manage…', docks.map((dock) => ({
      label: String(dock.name || 'Counter').slice(0, 100),
      value: dock.id,
      emoji: dock.channelType === 'text' ? '#️⃣' : '🔊',
      description: `${dock.enabled ? 'Active' : 'Off'} · ${dock.segments.length} value${dock.segments.length === 1 ? '' : 's'} · ${dock.segments.map((segment) => TYPE_LABELS[segment.type]?.[1] || segment.type).join(' + ')}`.slice(0, 100),
    })))));
  }
  components.push(row(button('admin:stats', '⬅️ Back', ButtonStyle.Secondary)));
  return { embeds: [embed], components };
}

function counterValueLines(guild, dock) {
  return dock.segments.map((segment, index) => {
    const [emoji, label] = TYPE_LABELS[segment.type] || ['•', segment.type];
    let extra = '';
    if (segment.type === 'status') extra = ` — ${(segment.options?.statuses || []).map((status) => STATUS_LABELS[status]?.[1] || status).join(', ')}`;
    if (segment.type === 'role') extra = ` — ${(segment.options?.roleIds || []).map((roleId) => guild.roles.cache.get(roleId)?.name).filter(Boolean).join(', ') || 'No role selected'}`;
    return `**${index + 1}.** ${emoji} ${label}${extra}`;
  }).join('\n');
}

function buildManagePanel(guild, dock, displayName = 'Management') {
  const embed = new EmbedBuilder()
    .setColor(dock.enabled ? 0x57F287 : 0x6B7280)
    .setTitle(`⚙️ ${dock.name || 'Counter'}`)
    .setDescription(dock.channelId ? `Counter channel: <#${dock.channelId}>` : 'This counter is saved but currently turned off.')
    .addFields(
      { name: 'Status', value: dock.enabled ? '🟢 On' : '⚫ Off', inline: true },
      { name: 'Channel Type', value: dock.channelType === 'text' ? '#️⃣ Text Channel' : '🔊 Voice Channel', inline: true },
      { name: 'Values in this channel', value: `${dock.segments.length} / 4`, inline: true },
      { name: 'What it displays', value: counterValueLines(guild, dock) || 'None', inline: false },
      { name: 'Channel text', value: `\`${dock.template}\``, inline: false }
    )
    .setFooter({ text: `Opened by ${displayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button(`admin:stats:edit:${dock.id}`, '✏️ Edit Counter', ButtonStyle.Primary),
        button(`admin:stats:add:${dock.id}`, '➕ Add Value', ButtonStyle.Success, dock.segments.length >= 4),
        button(`admin:stats:toggle:${dock.id}`, dock.enabled ? '⏸️ Turn Off' : '▶️ Turn On', dock.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      ),
      row(
        button(`admin:stats:delete:${dock.id}`, '🗑️ Delete', ButtonStyle.Danger),
        button('admin:stats:manager', '⬅️ Counters', ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildEditPanel(guild, dock, displayName = 'Management') {
  const outputOptions = [
    { label: 'Voice Channel', value: 'voice', emoji: '🔊', description: 'Statbot-style locked voice counter', default: dock.channelType !== 'text' },
    { label: 'Text Channel', value: 'text', emoji: '#️⃣', description: 'Read-only text counter channel', default: dock.channelType === 'text' },
  ];
  const valueOptions = dock.segments.map((segment, index) => ({
    label: `Value ${index + 1} — ${TYPE_LABELS[segment.type]?.[1] || segment.type}`.slice(0, 100),
    value: String(index),
    emoji: TYPE_LABELS[segment.type]?.[0] || '📊',
    description: 'Edit what this value counts',
  }));

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(`✏️ Edit ${dock.name || 'Counter'}`)
    .setDescription([
      'Change the **channel type** or choose one of the values inside this counter to configure it.',
      '',
      'A single Discord channel can display **up to four live values**.',
      'For separate role totals, add one value per role.',
    ].join('\n'))
    .addFields({ name: 'Current Values', value: counterValueLines(guild, dock) })
    .setFooter({ text: `Opened by ${displayName}` });

  return {
    embeds: [embed],
    components: [
      row(select(`admin:stats:output:${dock.id}`, 'Choose voice or text channel…', outputOptions)),
      row(select(`admin:stats:value:${dock.id}`, 'Choose a value to edit…', valueOptions)),
      row(button(`admin:stats:add:${dock.id}`, '➕ Add Another Value', ButtonStyle.Success, dock.segments.length >= 4)),
      row(button(`admin:stats:open:${dock.id}`, '⬅️ Back', ButtonStyle.Secondary)),
    ],
  };
}

function optionDefaults(items, selectedValues) {
  const selected = new Set(Array.isArray(selectedValues) ? selectedValues.map(String) : []);
  return items.map((item) => ({ ...item, default: selected.has(String(item.value)) }));
}

function buildValueEditPanel(guild, dock, index, displayName = 'Management') {
  const segment = dock.segments[index];
  if (!segment) return buildEditPanel(guild, dock, displayName);
  const options = segment.options || {};
  const [emoji, label] = TYPE_LABELS[segment.type] || ['📊', 'Counter'];
  const components = [row(select(`admin:stats:valuetype:${dock.id}:${index}`, 'What should this value show?', typeOptions(segment.type)))];

  if (segment.type === 'status') {
    const statusOptions = optionDefaults(Object.entries(STATUS_LABELS).map(([value, [statusEmoji, statusLabel]]) => ({ label: statusLabel, value, emoji: statusEmoji })), options.statuses || ['online']);
    components.push(row(select(`admin:stats:status:${dock.id}:${index}`, 'Choose statuses…', statusOptions, 1, 4)));
  } else if (segment.type === 'members') {
    const memberOptions = optionDefaults([
      { label: 'People', value: 'humans', emoji: '👤' },
      { label: 'Bots', value: 'bots', emoji: '🤖' },
    ], [options.humans !== false ? 'humans' : null, options.bots !== false ? 'bots' : null].filter(Boolean));
    components.push(row(select(`admin:stats:members:${dock.id}:${index}`, 'Choose who to count…', memberOptions, 1, 2)));
  } else if (segment.type === 'role') {
    const roleOptions = optionDefaults([...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .slice(0, 25)
      .map((role) => ({ label: role.name.slice(0, 100), value: role.id, description: `${role.members?.size || 0} members` })), options.roleIds || []);
    if (roleOptions.length) components.push(row(select(`admin:stats:roleselect:${dock.id}:${index}`, 'Choose role(s) to count together…', roleOptions, 1, Math.min(25, roleOptions.length))));
  } else if (segment.type === 'voice') {
    const modeOptions = optionDefaults([
      { label: 'All Voice Channels', value: 'all' },
      { label: 'Only Selected Channels', value: 'whitelist' },
      { label: 'All Except Selected', value: 'blacklist' },
    ], [options.mode || 'all']);
    components.push(row(select(`admin:stats:voicemode:${dock.id}:${index}`, 'Voice channel filter…', modeOptions)));
    if (options.mode && options.mode !== 'all') {
      const voiceChannels = optionDefaults([...guild.channels.cache.values()]
        .filter((channel) => [2, 13].includes(channel.type))
        .slice(0, 25)
        .map((channel) => ({ label: channel.name.slice(0, 100), value: channel.id })), options.channelIds || []);
      if (voiceChannels.length) components.push(row(select(`admin:stats:voicechannels:${dock.id}:${index}`, 'Choose voice channels…', voiceChannels, 1, Math.min(25, voiceChannels.length))));
    }
  } else if (segment.type === 'channels') {
    const channelOptions = optionDefaults([
      { label: 'Text Channels', value: 'text', emoji: '#️⃣' },
      { label: 'Voice Channels', value: 'voice', emoji: '🔊' },
      { label: 'Categories', value: 'category', emoji: '📁' },
    ], options.channelTypes || ['text', 'voice', 'category']);
    components.push(row(select(`admin:stats:channeltypes:${dock.id}:${index}`, 'Choose channel types…', channelOptions, 1, 3)));
  } else if (segment.type === 'roles') {
    const roleKinds = optionDefaults([
      { label: 'Server Roles', value: 'unmanaged', emoji: '🏷️' },
      { label: 'Integration / Bot Roles', value: 'managed', emoji: '🤖' },
    ], [options.unmanaged !== false ? 'unmanaged' : null, options.managed === true ? 'managed' : null].filter(Boolean));
    components.push(row(select(`admin:stats:roletypes:${dock.id}:${index}`, 'Choose role types…', roleKinds, 1, 2)));
  } else if (segment.type === 'datetime') {
    const formats = optionDefaults([
      { label: 'Sat, 12 Sep', value: 'weekday-short' },
      { label: 'Saturday, 12 September', value: 'weekday-long' },
      { label: '12/09/2026', value: 'date' },
      { label: '05:30', value: 'time' },
      { label: '12/09 05:30', value: 'date-time' },
    ], [options.format || 'weekday-short']);
    components.push(row(select(`admin:stats:dateformat:${dock.id}:${index}`, 'Choose date/time display…', formats)));
  } else if (segment.type === 'countdown') {
    components.push(row(select(`admin:stats:countdown:${dock.id}:${index}`, 'Set countdown duration…', [
      { label: '1 Hour', value: '60' },
      { label: '1 Day', value: '1440' },
      { label: '7 Days', value: '10080' },
      { label: '30 Days', value: '43200' },
    ])));
  }

  components.push(row(
    button(`admin:stats:remove:${dock.id}:${index}`, '🗑️ Remove Value', ButtonStyle.Danger, dock.segments.length <= 1),
    button(`admin:stats:edit:${dock.id}`, '⬅️ Back', ButtonStyle.Secondary)
  ));

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(`${emoji} Edit Value ${index + 1}: ${label}`)
    .setDescription(segment.type === 'role'
      ? 'Choose one or more roles to count **together**. To show separate role totals in the same channel, add another value for each role.'
      : 'Change what this value counts. The counter channel updates automatically after each change.')
    .setFooter({ text: `Opened by ${displayName}` });

  return { embeds: [embed], components: components.slice(0, 5) };
}

function buildAddValuePanel(dock) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('➕ Add Another Value')
      .setDescription(`This channel currently displays **${dock.segments.length} / 4** values. Choose what the new value should show.`)],
    components: [
      row(select(`admin:stats:addtype:${dock.id}`, 'Choose a value to add…', typeOptions())),
      row(button(`admin:stats:open:${dock.id}`, '⬅️ Cancel', ButtonStyle.Secondary)),
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

async function saveSegments(interaction, dock, segments, displayName, nextPanel = 'edit') {
  const updated = await stats.counters.updateDock(interaction.guild, dock.id, {
    segments,
    name: generatedName(segments),
    template: generatedTemplate(interaction.guild, segments),
  }, interaction.guild);
  if (nextPanel === 'manage') return safeUpdate(interaction, buildManagePanel(interaction.guild, updated, displayName));
  return safeUpdate(interaction, buildEditPanel(interaction.guild, updated, displayName));
}

async function handleStatsAdminInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:stats')) return false;
  const displayName = memberName(interaction);

  if (id === 'admin:stats') return safeUpdate(interaction, buildStatsAdminPanel(interaction.guild, displayName));
  if (id === 'admin:stats:manager') return safeUpdate(interaction, buildCounterManagerPanel(interaction.guild, displayName));

  if (interaction.isStringSelectMenu?.()) {
    if (id === 'admin:stats:create') {
      await interaction.deferUpdate().catch(() => null);
      const type = interaction.values?.[0];
      const segments = [defaultSegment(type)];
      stats.setEnabled(interaction.guild.id, true, interaction.guild);
      const dock = await stats.counters.createDock(interaction.guild, {
        name: generatedName(segments),
        template: generatedTemplate(interaction.guild, segments),
        channelType: 'voice',
        segments,
        source: 'panel',
      }, interaction.guild);
      return safeUpdate(interaction, buildManagePanel(interaction.guild, dock, displayName));
    }

    if (id === 'admin:stats:manage') {
      const dock = findDock(interaction.guild.id, interaction.values?.[0]);
      return safeUpdate(interaction, dock ? buildManagePanel(interaction.guild, dock, displayName) : buildCounterManagerPanel(interaction.guild, displayName));
    }

    const outputMatch = id.match(/^admin:stats:output:(.+)$/);
    if (outputMatch) {
      await interaction.deferUpdate().catch(() => null);
      const dock = findDock(interaction.guild.id, outputMatch[1]);
      if (!dock) return safeUpdate(interaction, buildCounterManagerPanel(interaction.guild, displayName));
      const updated = await stats.counters.updateDock(interaction.guild, dock.id, { channelType: interaction.values?.[0] }, interaction.guild);
      return safeUpdate(interaction, buildEditPanel(interaction.guild, updated, displayName));
    }

    const valueMatch = id.match(/^admin:stats:value:(.+)$/);
    if (valueMatch) {
      const dock = findDock(interaction.guild.id, valueMatch[1]);
      return safeUpdate(interaction, dock ? buildValueEditPanel(interaction.guild, dock, Number(interaction.values?.[0] || 0), displayName) : buildCounterManagerPanel(interaction.guild, displayName));
    }

    const addTypeMatch = id.match(/^admin:stats:addtype:(.+)$/);
    if (addTypeMatch) {
      await interaction.deferUpdate().catch(() => null);
      const dock = findDock(interaction.guild.id, addTypeMatch[1]);
      if (!dock || dock.segments.length >= 4) return safeUpdate(interaction, dock ? buildManagePanel(interaction.guild, dock, displayName) : buildCounterManagerPanel(interaction.guild, displayName));
      return saveSegments(interaction, dock, [...dock.segments, defaultSegment(interaction.values?.[0])], displayName);
    }

    const valueTypeMatch = id.match(/^admin:stats:valuetype:([^:]+):(\d+)$/);
    if (valueTypeMatch) {
      await interaction.deferUpdate().catch(() => null);
      const dock = findDock(interaction.guild.id, valueTypeMatch[1]);
      const index = Number(valueTypeMatch[2]);
      if (!dock?.segments[index]) return safeUpdate(interaction, buildCounterManagerPanel(interaction.guild, displayName));
      const segments = [...dock.segments];
      segments[index] = defaultSegment(interaction.values?.[0]);
      const updated = await stats.counters.updateDock(interaction.guild, dock.id, { segments, name: generatedName(segments), template: generatedTemplate(interaction.guild, segments) }, interaction.guild);
      return safeUpdate(interaction, buildValueEditPanel(interaction.guild, updated, index, displayName));
    }

    const configMatch = id.match(/^admin:stats:(status|members|roleselect|voicemode|voicechannels|channeltypes|roletypes|dateformat|countdown):([^:]+):(\d+)$/);
    if (configMatch) {
      await interaction.deferUpdate().catch(() => null);
      const action = configMatch[1];
      const dock = findDock(interaction.guild.id, configMatch[2]);
      const index = Number(configMatch[3]);
      if (!dock?.segments[index]) return safeUpdate(interaction, buildCounterManagerPanel(interaction.guild, displayName));
      const segments = dock.segments.map((segment) => ({ ...segment, options: { ...(segment.options || {}) } }));
      const options = segments[index].options;
      const values = interaction.values || [];

      if (action === 'status') options.statuses = values;
      else if (action === 'members') { options.humans = values.includes('humans'); options.bots = values.includes('bots'); }
      else if (action === 'roleselect') options.roleIds = values;
      else if (action === 'voicemode') { options.mode = values[0] || 'all'; if (options.mode === 'all') options.channelIds = []; }
      else if (action === 'voicechannels') options.channelIds = values;
      else if (action === 'channeltypes') options.channelTypes = values;
      else if (action === 'roletypes') { options.unmanaged = values.includes('unmanaged'); options.managed = values.includes('managed'); }
      else if (action === 'dateformat') options.format = values[0] || 'weekday-short';
      else if (action === 'countdown') options.timestamp = Date.now() + Number(values[0] || 1440) * 60000;

      const updated = await stats.counters.updateDock(interaction.guild, dock.id, { segments, template: generatedTemplate(interaction.guild, segments) }, interaction.guild);
      return safeUpdate(interaction, buildValueEditPanel(interaction.guild, updated, index, displayName));
    }
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
    const dock = findDock(interaction.guild.id, id.slice('admin:stats:open:'.length));
    return safeUpdate(interaction, dock ? buildManagePanel(interaction.guild, dock, displayName) : buildCounterManagerPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:edit:')) {
    const dock = findDock(interaction.guild.id, id.slice('admin:stats:edit:'.length));
    return safeUpdate(interaction, dock ? buildEditPanel(interaction.guild, dock, displayName) : buildCounterManagerPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:add:')) {
    const dock = findDock(interaction.guild.id, id.slice('admin:stats:add:'.length));
    return safeUpdate(interaction, dock && dock.segments.length < 4 ? buildAddValuePanel(dock) : dock ? buildManagePanel(interaction.guild, dock, displayName) : buildCounterManagerPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:remove:')) {
    await interaction.deferUpdate().catch(() => null);
    const match = id.match(/^admin:stats:remove:([^:]+):(\d+)$/);
    const dock = match ? findDock(interaction.guild.id, match[1]) : null;
    const index = match ? Number(match[2]) : -1;
    if (!dock || dock.segments.length <= 1 || !dock.segments[index]) return safeUpdate(interaction, dock ? buildEditPanel(interaction.guild, dock, displayName) : buildCounterManagerPanel(interaction.guild, displayName));
    const segments = dock.segments.filter((_, segmentIndex) => segmentIndex !== index);
    return saveSegments(interaction, dock, segments, displayName);
  }

  if (id.startsWith('admin:stats:toggle:')) {
    await interaction.deferUpdate().catch(() => null);
    const dock = findDock(interaction.guild.id, id.slice('admin:stats:toggle:'.length));
    if (!dock) return safeUpdate(interaction, buildCounterManagerPanel(interaction.guild, displayName));
    const updated = await stats.counters.setDockEnabled(interaction.guild, dock.id, !dock.enabled, interaction.guild);
    return safeUpdate(interaction, buildManagePanel(interaction.guild, updated, displayName));
  }

  if (id.startsWith('admin:stats:delete-confirm:')) {
    await interaction.deferUpdate().catch(() => null);
    const dockId = id.slice('admin:stats:delete-confirm:'.length);
    await stats.counters.deleteDock(interaction.guild, dockId, interaction.guild);
    return safeUpdate(interaction, buildCounterManagerPanel(interaction.guild, displayName));
  }

  if (id.startsWith('admin:stats:delete:')) {
    const dock = findDock(interaction.guild.id, id.slice('admin:stats:delete:'.length));
    return safeUpdate(interaction, dock ? buildDeleteConfirmation(dock) : buildCounterManagerPanel(interaction.guild, displayName));
  }

  return false;
}

module.exports = { buildStatsAdminPanel, handleStatsAdminInteraction };
