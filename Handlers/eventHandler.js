const { loadFiles } = require("../Functions/fileLoader");

async function loadEvents(client) {

    client.events = new Map();
    client.subCommands = new Map();
    const events = new Array();

    const files = await loadFiles("Events");

    for (const file of files) {
        try {
            const event = require(file);
            const execute = async (...args) => {
                try {
                    await event.execute(...args, client);
                } catch (error) {
                    console.error(`Event calistirilirken hata olustu: ${event.name}`, error);
                }
            };
            const target = event.rest ? client.rest : client;

            target[event.once ? "once" : "on"](event.name, execute);
            client.events.set(event.name, execute);

            events.push({ Event: event.name, Durum: "✅"});
        } catch (error) {
            events.push({ Event: file.split("/").pop().slice(0, -3), Durum: "❌"});
        }
    }

    console.table(events, ["Event", "Durum"]);
    console.info("\n\x1b[36m%s\x1b[0m", "Events Yüklendi ✅");
}

module.exports = { loadEvents };
