// Routes slash commands and components to their handlers.
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { client } = require('./client');
const { handleComponents } = require('./component-handlers');
const { hasCommandPermission } = require('./helpers');
const { getConfig } = require('./db');
const { runHelp, runInvite } = require('./commands/general');
const { runGlobalHashes, runScam } = require('./commands/scam');
const { runConfig, runEscalation } = require('./commands/config');
const { runMyWarnings, runWarningGive, runWarningHistory, runWarningList, runWarningRemove } = require('./commands/warning');
const { runBan, runKick, runTimeout } = require('./commands/moderation');
const { runNote, runUserinfo } = require('./commands/records');
const { runCrosspost, runSpam } = require('./commands/protection');
const { runMessages } = require('./commands/messages');

client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand()) { await handleComponents(interaction); return; }
    const { commandName, guildId } = interaction;
    if (!interaction.guild) return interaction.reply({ content: '❌ Server only.', flags: [MessageFlags.Ephemeral] });
    const restricted = ['config','warning','timeout','kick','ban','note','userinfo','escalation','scam','spam','crosspost','messages'];
    if (restricted.includes(commandName) && !await hasCommandPermission(interaction, guildId)) {
        const cfg = await getConfig(guildId);
        return interaction.reply({ content: `❌ No permission.\n\n**Required:** Administrator OR ${cfg.accessRoleId ? `<@&${cfg.accessRoleId}>` : 'no role configured'}\n\nAsk an admin to run \`/config access\`.`, flags: [MessageFlags.Ephemeral] });
    }
    const E = (color, title) => new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
    const reply = (opts) => {
        if (interaction.deferred) { if (typeof opts === 'string') return interaction.editReply({ content: opts }); const { flags, ...rest } = opts; return interaction.editReply(rest); }
        return interaction.reply(typeof opts === 'string' ? { content: opts, flags: [MessageFlags.Ephemeral] } : opts);
    };
    const ctx = { interaction, commandName, guildId, E, reply };
    if (commandName === 'invite') await runInvite(ctx);
    else if (commandName === 'help') await runHelp(ctx);
    else if (commandName === 'globalhashes') await runGlobalHashes(ctx);
    else if (commandName === 'config') await runConfig(ctx);
    else if (commandName === 'warning' && interaction.options.getSubcommand() === 'give') await runWarningGive(ctx);
    else if (commandName === 'warning' && interaction.options.getSubcommand() === 'remove') await runWarningRemove(ctx);
    else if (commandName === 'timeout') await runTimeout(ctx);
    else if (commandName === 'mywarnings') await runMyWarnings(ctx);
    else if (commandName === 'warning' && interaction.options.getSubcommand() === 'list') await runWarningList(ctx);
    else if (commandName === 'warning' && interaction.options.getSubcommand() === 'history') await runWarningHistory(ctx);
    else if (commandName === 'kick') await runKick(ctx);
    else if (commandName === 'ban') await runBan(ctx);
    else if (commandName === 'userinfo') await runUserinfo(ctx);
    else if (commandName === 'note') await runNote(ctx);
    else if (commandName === 'scam') await runScam(ctx);
    else if (commandName === 'spam') await runSpam(ctx);
    else if (commandName === 'crosspost') await runCrosspost(ctx);
    else if (commandName === 'messages') await runMessages(ctx);
    else if (commandName === 'escalation') await runEscalation(ctx);
  } catch (error) {
      if (error?.code === 40060) return;
      console.error('❌ Interaction error:', error);
      try {
          if (interaction.deferred) await interaction.editReply({ content: '❌ Something went wrong. Please try again.' }).catch(() => {});
          else if (!interaction.replied) await interaction.reply({ content: '❌ Something went wrong. Please try again.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
      } catch {}
  }
});
