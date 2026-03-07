const { ChatInputCommandInteraction, Client, MessageFlags } = require("discord.js");
const { loadCommands } = require("../../../Handlers/commandHandler");

module.exports = {
    subCommand: "reload.commands",
    /**
     * 
     * @param {ChatInputCommandInteraction} interaction 
     * @param {Client} client 
     */
    execute(interaction, client) {
        loadCommands(client);
        interaction.reply({content: "Komutlar Yeniden Başlatıldı", flags: MessageFlags.Ephemeral});
    }
}
