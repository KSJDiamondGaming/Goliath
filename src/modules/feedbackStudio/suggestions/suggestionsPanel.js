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
const embedTemplates = require('../../messageStudio/embed/embedTemplates');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const panelNavigation = require('../../../core/ui/panelNavigation');

const SUGGESTIONS_COLOR = 0xfee75c;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const formatChannel = (id) => id ? `<#${id}>` : '*Not set*';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '*None selected*';
const statusEmoji = (status) => status === 'approved' ? '✅' : status === 'denied' ? '❌' : '💡';
const statusLabel = (status, section = {}) => status === 'approved' ? 'Approved' : status === 'denied' ? 'Declined' : section.requireReview !== false ? 'Awaiting review' : 'Open';

function compactPreview(content, maxLength = 80) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function shortDate(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown date';
}

function discordTimestamp(value, style = 'F') {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function voteSummary(suggestion) {
  return `👍 **${suggestion.upVotes.length}** support   ·   👎 **${suggestion.downVotes.length}** not for me`;
}

function publicSuggestionAuthor(suggestion) {
  if (suggestion?.anonymous === true) return '🔒 Anonymous member';
  return suggestion?.authorId ? `<@${suggestion.authorId}>` : 'Community member';
}

function defaultTeamResponse(suggestion) {
  if (suggestion?.reviewReason) return suggestion.reviewReason;
  if (suggestion?.status === 'approved') return 'The team has approved this suggestion.';
  if (suggestion?.status === 'denied') return 'The team has decided not to move forward with this suggestion.';
  return '';
}

function templateVariables(guild, suggestion = null, section = {}) {
  const now = new Date();
  const icon = guild?.iconURL?.({ extension: 'png', size: 512 }) || '';
  const banner = guild?.bannerURL?.({ extension: 'png', size: 1024 }) || '';
  const memberCount = Number(guild?.memberCount || 0);
  const enabled = guild?.id ? isModuleEnabled(guild.id, 'suggestions') : true;
  const status = suggestion ? statusLabel(suggestion.status, section) : '';

  return {
    guild: guild?.name || 'Server',
    guildName: guild?.name || 'Server',
    server: guild?.name || 'Server',
    serverName: guild?.name || 'Server',
    guildId: guild?.id || '',
    guildIcon: icon,
    guildBanner: banner,
    memberCount,
    createdAt: discordTimestamp(now, 'F'),
    timestamp: discordTimestamp(now, 'F'),
    suggestion: suggestion?.content || '',
    suggestionAuthor: suggestion ? publicSuggestionAuthor(suggestion) : '',
    suggestionStatus: status,
    upVotes: suggestion?.upVotes?.length || 0,
    downVotes: suggestion?.downVotes?.length || 0,
    teamResponse: suggestion ? defaultTeamResponse(suggestion) : '',
    submittedAt: suggestion?.createdAt ? discordTimestamp(suggestion.createdAt, 'F') : '',
    decisionAt: suggestion?.reviewedAt || suggestion?.updatedAt
      ? discordTimestamp(suggestion.reviewedAt || suggestion.updatedAt, 'F')
      : '',
    suggestionsEnabled: enabled ? 'On' : 'Off',
    anonymousMode: section.anonymous === true ? 'On' : 'Off',
  };
}

function suggestionTemplateSlot(suggestion) {
  if (suggestion?.status === 'approved') return 'suggestion_accepted';
  if (suggestion?.status === 'denied') return 'suggestion_denied';
  return 'suggestion_pending';
}

function renderSuggestionBinding(guild, slot, variables) {
  if (!guild?.id) return null;
  try {
    return embedTemplates.renderBinding(guild.id, 'suggestions', slot, variables);
  } catch (error) {
    console.warn(`[Suggestions] Embed Studio template ${slot} could not be rendered:`, error.message || error);
    return null;
  }
}

function applyTemplateEmbed(rendered, fallbackEmbed, timestampValue = null) {
  if (!rendered?.embed) return fallbackEmbed;
  const source = rendered.embed;
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR);

  if (source.title) embed.setTitle(source.title);
  if (source.description) embed.setDescription(source.description);
  if (Array.isArray(source.fields) && source.fields.length) embed.addFields(source.fields);
  if (source.author?.name) {
    const author = { name: source.author.name };
    if (source.author.iconURL) author.iconURL = source.author.iconURL;
    if (source.author.url) author.url = source.author.url;
    embed.setAuthor(author);
  }
  if (source.footer?.text) {
    const footer = { text: source.footer.text };
    if (source.footer.iconURL) footer.iconURL = source.footer.iconURL;
    embed.setFooter(footer);
  }
  if (source.thumbnailURL) embed.setThumbnail(source.thumbnailURL);
  if (source.imageURL) embed.setImage(source.imageURL);
  if (timestampValue) embed.setTimestamp(new Date(timestampValue));

  return embed;
}

function defaultSuggestionEmbed(guild, suggestion, section) {
  const enabled = guild?.id ? isModuleEnabled(guild.id, 'suggestions') : true;
  const fields = [
    {
      name: 'Shared by',
      value: publicSuggestionAuthor(suggestion),
      inline: true,
    },
    {
      name: 'Status',
      value: `${statusEmoji(suggestion.status)} ${statusLabel(suggestion.status, section)}`,
      inline: true,
    },
  ];

  if (section.voting !== false || suggestion.upVotes.length || suggestion.downVotes.length) {
    fields.push({ name: 'Community feedback', value: voteSummary(suggestion), inline: false });
  }

  if (suggestion.status !== 'pending') {
    fields.push({ name: 'Decision made', value: discordTimestamp(suggestion.reviewedAt || suggestion.updatedAt, 'R'), inline: true });
    fields.push({ name: 'Team response', value: defaultTeamResponse(suggestion), inline: false });
  }

  const title = suggestion.status === 'approved'
    ? '💡 Approved Suggestion'
    : suggestion.status === 'denied'
      ? '💡 Declined Suggestion'
      : '💡 Community Suggestion';

  let footer = 'Thanks for helping improve the community.';
  if (suggestion.status === 'pending' && !enabled) footer = 'Suggestions are currently paused.';
  else if (suggestion.status === 'pending' && section.voting !== false) footer = 'Use the buttons below to share your view.';
  else if (suggestion.status === 'pending' && section.requireReview !== false) footer = 'This suggestion is waiting for the team to review it.';

  return new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle(title)
    .setDescription(suggestion.content || '_No suggestion text was provided._')
    .addFields(fields)
    .setFooter({ text: footer })
    .setTimestamp(new Date(suggestion.createdAt || Date.now()));
}

function buildSuggestionPresentation(guild, suggestion, section) {
  const fallbackEmbed = defaultSuggestionEmbed(guild, suggestion, section);
  const rendered = renderSuggestionBinding(
    guild,
    suggestionTemplateSlot(suggestion),
    templateVariables(guild, suggestion, section),
  );
  return {
    content: rendered?.content || undefined,
    embed: applyTemplateEmbed(rendered, fallbackEmbed, suggestion.createdAt || Date.now()),
  };
}

function buildSuggestionEmbed(guild, suggestion, section) {
  return buildSuggestionPresentation(guild, suggestion, section).embed;
}

function buildSuggestionRows(suggestion, section, enabled = true) {
  const rows = [];
  if (!enabled || suggestion.status !== 'pending') return rows;

  if (section.voting !== false) {
    rows.push(row(
      button(`suggestions:vote:${suggestion.suggestionId}:up`, `👍 Support · ${suggestion.upVotes.length}`, ButtonStyle.Secondary),
      button(`suggestions:vote:${suggestion.suggestionId}:down`, `👎 Not for me · ${suggestion.downVotes.length}`, ButtonStyle.Secondary),
    ));
  }

  if (section.requireReview !== false) {
    rows.push(row(
      button(`suggestions:reviewOpen:${suggestion.suggestionId}`, '🛡️ Team Review', ButtonStyle.Primary),
    ));
  }
  return rows;
}

function buildSuggestionMessagePayload(guild, suggestion, section, enabled = true, includeComponents = true) {
  const presentation = buildSuggestionPresentation(guild, suggestion, section);
  return {
    content: presentation.content || null,
    embeds: [presentation.embed],
    components: includeComponents ? buildSuggestionRows(suggestion, section, enabled) : [],
  };
}

function defaultSubmitPanelEmbed(section, enabled) {
  const privacyNote = section.anonymous === true
    ? '\n\n🔒 **Anonymous suggestions are on.** Your name will not appear on suggestions you share.'
    : '';
  const description = enabled
    ? `Got an idea that could make the server better? Share it here.\n\nYou can open **My Suggestions** at any time to see what you have shared and check the team’s response.${privacyNote}`
    : 'Suggestions are paused right now. You can still open **My Suggestions** to view ideas you have already shared.';

  return new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions')
    .setDescription(description)
    .setFooter({ text: enabled ? 'Every idea is welcome.' : 'Please check back later.' })
    .setTimestamp();
}

function buildSubmitPanelPayload(guildOrId) {
  const guild = guildOrId && typeof guildOrId === 'object' ? guildOrId : null;
  const guildId = guild?.id || String(guildOrId || '');
  const section = suggestions.getSection(guildId);
  const enabled = isModuleEnabled(guildId, 'suggestions');
  const fallbackEmbed = defaultSubmitPanelEmbed(section, enabled);
  const rendered = renderSuggestionBinding(guild, 'suggestion_panel', templateVariables(guild, null, section));
  const submitButton = button('suggestions:submit', section.anonymous ? 'Share Anonymously' : 'Share a Suggestion')
    .setDisabled(!enabled);

  return {
    content: rendered?.content || null,
    embeds: [applyTemplateEmbed(rendered, fallbackEmbed, Date.now())],
    components: [row(
      submitButton,
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
  const section = suggestions.getSection(guildId);
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
    ? pageRecords.map((item) => {
      const privacy = item.anonymous === true ? ' · 🔒 Anonymous' : '';
      return `${statusEmoji(item.status)} **${statusLabel(item.status, section)}** · ${shortDate(item.createdAt)}${privacy}\n${compactPreview(item.content, 120)}`;
    })
    : ['You have not shared any suggestions yet.'];

  const components = [];
  if (pageRecords.length) {
    components.push(row(new StringSelectMenuBuilder()
      .setCustomId('suggestions:mine:select')
      .setPlaceholder('Open one of your suggestions')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(pageRecords.map((item) => ({
        label: `${statusEmoji(item.status)} ${statusLabel(item.status, section)} · ${compactPreview(item.content, 60) || 'Suggestion'}`.slice(0, 100),
        description: `${item.anonymous === true ? 'Anonymous · ' : ''}Shared ${shortDate(item.createdAt)}`.slice(0, 100),
        value: `${item.suggestionId}|${safePage}`,
      })))));
  }

  components.push(row(
    button(`suggestions:mine:page:${Math.max(0, safePage - 1)}`, '⬅️ Previous', ButtonStyle.Secondary).setDisabled(safePage === 0),
    button(`suggestions:mine:page:${Math.min(totalPages - 1, safePage + 1)}`, 'Next ➡️', ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    button('suggestions:mine:close', 'Close', ButtonStyle.Secondary),
  ));

  return {
    embeds: [new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle('💡 My Suggestions')
      .setDescription([
        'Your private suggestion history.',
        '',
        `💡 Waiting: **${counts.pending}**   ·   ✅ Approved: **${counts.approved}**   ·   ❌ Declined: **${counts.denied}**`,
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
  const section = suggestions.getSection(guildId);
  const item = suggestions.getSuggestion(guildId, suggestionId);
  if (!item || String(item.authorId || '') !== String(userId || '')) throw new Error('That suggestion could not be found in your history.');

  const fields = [
    { name: 'Status', value: `${statusEmoji(item.status)} ${statusLabel(item.status, section)}`, inline: true },
    { name: 'Shared', value: item.anonymous === true ? '🔒 Anonymously' : 'With your name', inline: true },
    { name: 'Submitted', value: discordTimestamp(item.createdAt, 'F'), inline: false },
  ];

  if (section.voting !== false || item.upVotes.length || item.downVotes.length) {
    fields.push({ name: 'Community feedback', value: voteSummary(item), inline: false });
  }

  if (item.status === 'pending') {
    fields.push({
      name: 'Team response',
      value: section.requireReview !== false ? 'The team has not reviewed this suggestion yet.' : 'No team decision is required for this suggestion.',
      inline: false,
    });
  } else {
    fields.push({ name: 'Decision made', value: discordTimestamp(item.reviewedAt || item.updatedAt, 'F'), inline: false });
    fields.push({
      name: 'Team response',
      value: item.reviewReason || (item.status === 'approved'
        ? 'The team approved your suggestion.'
        : 'The team decided not to move forward with your suggestion this time.'),
      inline: false,
    });
  }

  return {
    embeds: [new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle('💡 Your Suggestion')
      .setDescription(item.content || '_No suggestion text was provided._')
      .addFields(fields)
      .setFooter({ text: 'Only you can see this.' })
      .setTimestamp(new Date(item.updatedAt || item.createdAt || Date.now()))],
    components: [row(
      button(`suggestions:mine:page:${Math.max(0, Number(page) || 0)}`, '⬅️ My Suggestions', ButtonStyle.Secondary),
      button('suggestions:mine:close', 'Close', ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

function buildReviewerDecisionPayload(guild, suggestionId) {
  const section = suggestions.getSection(guild.id);
  const item = suggestions.getSuggestion(guild.id, suggestionId);
  if (!item) throw new Error('That suggestion could not be found.');
  if (item.status !== 'pending') throw new Error(`This suggestion has already been ${item.status === 'approved' ? 'approved' : 'declined'}.`);

  const approvedDestination = section.approvedChannelId ? `<#${section.approvedChannelId}>` : 'the original suggestion only';
  const declinedDestination = section.deniedChannelId ? `<#${section.deniedChannelId}>` : 'the original suggestion only';

  return {
    embeds: [new EmbedBuilder()
      .setColor(SUGGESTIONS_COLOR)
      .setTitle('💡 Review Suggestion')
      .setDescription(item.content || '_No suggestion text was provided._')
      .addFields(
        { name: 'Shared by', value: publicSuggestionAuthor(item), inline: true },
        { name: 'Community feedback', value: voteSummary(item), inline: false },
        {
          name: 'What happens next?',
          value: [
            'Choosing **Approve** or **Decline** closes the suggestion and voting.',
            'The member will be notified privately and can see the team response in **My Suggestions**.',
            `Approved result: ${approvedDestination}`,
            `Declined result: ${declinedDestination}`,
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Only the review team can make a decision.' })
      .setTimestamp(new Date(item.createdAt || Date.now()))],
    components: [row(
      button(`suggestions:review:${item.suggestionId}:approve`, '✅ Approve', ButtonStyle.Success),
      button(`suggestions:review:${item.suggestionId}:deny`, '❌ Decline', ButtonStyle.Danger),
      button('suggestions:reviewClose', 'Cancel', ButtonStyle.Secondary),
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
        .setLabel('Response to share (optional)')
        .setPlaceholder('This will be shown with the final decision and sent to the member.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(false),
    ));
}

function overviewDescription(section, enabled) {
  return [
    'Choose where members share ideas, who can review them, and how suggestions work for your community.',
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
    `• Team review: ${section.requireReview !== false ? 'On ✅' : 'Off ❌'}`,
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
        'You can optionally post approved and declined suggestions into separate channels.',
        '',
        `**Approved suggestions:** ${formatChannel(section.approvedChannelId)}`,
        `**Declined suggestions:** ${formatChannel(section.deniedChannelId)}`,
        '',
        'If a channel is left unset, the original suggestion is still updated with the final decision.',
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
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:submitChannel').setPlaceholder('Where members share suggestions').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
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

async function refreshDeployedPanel(guild) {
  if (!guild?.id) return null;
  const section = suggestions.getSection(guild.id);
  const existing = await fetchDeploymentMessage(guild, section.deployment);
  if (!existing?.editable) return null;
  await existing.edit(buildSubmitPanelPayload(guild));
  return existing;
}

async function deploySubmitPanel(guild) {
  const section = tracking.assertEnabled(guild?.id);
  if (!section.submitChannelId) throw new Error('Choose where members should share suggestions first.');

  const channel = await tracking.resolveSendableChannel(guild, section.submitChannelId, 'suggestions channel', { requireHistory: true });
  const payload = buildSubmitPanelPayload(guild);
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
  templateVariables,
  buildSuggestionEmbed,
  buildSuggestionRows,
  buildSuggestionMessagePayload,
  buildSubmitPanelPayload,
  buildMySuggestionsPayload,
  buildMySuggestionDetail,
  buildReviewerDecisionPayload,
  buildSubmitModal,
  buildReviewModal,
  buildReviewerRolesPanel,
  buildSuggestionsAdminPanel,
  refreshDeployedPanel,
  deploySubmitPanel,
};