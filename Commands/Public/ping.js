const { ChatInputCommandInteraction, SlashCommandBuilder, Client, EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Botun Pingini Gösterir"),
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction, client) {
        const initialResponse = await interaction.reply({ content: "**Yükleniyor..**", flags: MessageFlags.Ephemeral });
        setTimeout(async () => {
            await initialResponse.edit({ content: `🏓 Pingim: **${client.ws.ping}ms**`});
        }, 1000);
    }
}
