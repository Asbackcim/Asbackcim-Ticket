const { ChatInputCommandInteraction, Client, MessageFlags } = require("discord.js");

module.exports = {
    name: "interactionCreate",
    /**
     * 
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction, client) {
        if(!interaction.isChatInputCommand()) return;

        try {
            const { user, options } = interaction;
            const developerId = String(client.config?.DeveloperID || "").trim();

            const command = client.commands.get(interaction.commandName);
            if(!command)
            return interaction.reply({  content: "Bu komut artık kullanılmıyor!", flags: MessageFlags.Ephemeral });

            if(command.developer && user.id !== developerId)
            return interaction.reply({ content: "Bu komutu kullana bilmek için **Bot Sahibim** olmalısın!", flags: MessageFlags.Ephemeral });

            const subCommand = options.getSubcommand(false);
            if(subCommand) {
                const subCommandFile = client.subCommands.get(`${interaction.commandName}.${subCommand}`);
                if(!subCommandFile) return interaction.reply({ content: "Bu komut artık kullanılmıyor!", flags: MessageFlags.Ephemeral });
                return await subCommandFile.execute(interaction, client);
            }

            return await command.execute(interaction, client);
        } catch (error) {
            console.error("Slash command calistirilirken hata olustu:", error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: "Komut calisirken bir hata olustu.", components: [] }).catch(() => null);
            }

            return interaction.reply({
                content: "Komut calisirken bir hata olustu.",
                flags: MessageFlags.Ephemeral,
            }).catch(() => null);
        }
    }
}
