const { ActivityType } = require("discord.js")
const { loadCommands } = require("../../Handlers/commandHandler");
const { BRANDING } = require("../../services/branding");

module.exports = {
    name: "clientReady",
    once: true,
    execute(client) {
        client.user.setActivity({
            name: BRANDING.presence,
            type: ActivityType.Watching,
        });

        loadCommands(client);
    }
}
