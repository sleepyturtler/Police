// Help page navigation buttons.
const { helpOverviewEmbed, helpPages, helpRows } = require('../ui/help');

function matches(interaction) {
    return interaction.isButton() && interaction.customId.startsWith('help_');
}

async function handle(interaction) {
    if (interaction.isButton()) {
        const { customId } = interaction;
        if (customId.startsWith('help_') && customId !== 'help_back') { const embed = helpPages[customId]; if (!embed) return; return interaction.update({ embeds: [embed], components: helpRows(customId) }); }
        if (customId === 'help_back') return interaction.update({ embeds: [helpOverviewEmbed()], components: helpRows() });
        return;
    }
}

module.exports = { matches, handle };
