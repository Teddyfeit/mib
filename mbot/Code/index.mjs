import mineflayer from 'mineflayer';
import { readFile } from 'fs/promises';
import fs from 'fs';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;

let botArgs = {};
let botNames = [];
let config = {};
let owner;
let version = "1.2r";

async function readConfigFile() {
    try {
        const data = await readFile('./Setup/INFO.json', 'utf8');
        config = JSON.parse(data);
        botArgs.host = config.host;
        botArgs.version = config.version;
        owner = config.owner;

        if (config.needsPort) {
            botArgs.port = config.port;
        }
    } catch (error) {
        console.error('Error reading or parsing INFO.json:', error);
        process.exit(1);
    }
}

async function readAccountFile() {
    try {
        const data = await readFile('./Setup/ACCOUNT.json', 'utf8');
        const accounts = JSON.parse(data);
        return accounts[0];
    } catch (error) {
        console.error('Error reading ACCOUNT.json:', error);
        process.exit(1);
    }
}

class MCBot {
    constructor(username, auth) {
        this.username = username;
        this.auth = auth;
        this.host = botArgs.host;
        this.port = botArgs.port;
        this.version = botArgs.version;

        this.initBot();
        this.initConsoleInput();
    }

    initBot() {
        const botOptions = {
            username: this.username,
            auth: this.auth,
            host: this.host,
            version: this.version
        };

        if (this.port) {
            botOptions.port = this.port;
        }

        this.bot = mineflayer.createBot(botOptions);

        botNames.push(this.bot.username);
        this.bot.loadPlugin(pathfinder);
        this.initEvents();

        this.bot.once('spawn', () => {
            if (config.noChat === true) {
                this.bot.chat(`${config.customStartMsg}`);
            } else {
                this.bot.chat(`Minebot ${version} by Eglijohn. For help type !help.`);
            }
        });
    }

    initConsoleInput() {
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', async (data) => {
            const input = data.trim();

            if (input.startsWith('!')) {
                const command = input.substring(1);
                await this.executeCommand(command);
            } else {
                this.bot.chat(input);
            }
        });
    }

    reconnect() {
        setTimeout(() => {
            this.initBot();
        }, 5000);
    }

    async executeCommand(command) {
        const [cmd, ...args] = command.split(' ');

        switch (cmd) {
            case 'help':
                this.log(`[LOG] !setowner <name>, !quit, !players. [DM] = Direct Message (/tell, /msg), [PC] = Public Chat.`);
                break;

            case 'players':
                const playerList = Object.keys(this.bot.players).filter(player => player !== this.bot.username);
                if (playerList.length > 0) {
                    this.log(`[LOG] Online players: ${playerList.join(', ')}`);
                } else {
                    this.log(`[LOG] No other players online.`);
                }
                break;

            case 'quit':
                this.bot.end();
                if (config.processquit === false) {
                    this.reconnect();
                } else {
                    process.exit();
                }
                break;

            case 'setowner':
                const newOwner = command.substring(8);
                owner = newOwner;
                this.log(`[LOG] New owner set to: ${owner}`);
                this.bot.chat(`/msg ${owner} Congrats, you are now the new user!`);
                break;

            case 'say':
                this.log('[LOG] Try type the Text without a syntax before.')

            case 'follow':
            case 'stopfollow':
            case 'mine':
                this.log(`[LOG] Command '${cmd}' must be used from Minecraft chat.`);
                break;

            default:
                this.log(`[LOG] Unknown command '${cmd}'. Use !help for command list.`);
                break;
        }
    }

    log(...msg) {
        const logMessage = `[LOG] [${this.bot.username}] ${msg.join(' ')}`;
        fs.appendFileSync('log.txt', logMessage + '\n');
        console.log(...msg);
    }

    chatLog(username, ...msg) {
        if (!botNames.includes(username)) {
            const message = msg.join(' ');
            const logMessage = `[PC]  <${username}> ${message}`;
            fs.appendFileSync('log.txt', logMessage + '\n');
            console.log(logMessage);
        }
    }

    whisperLog(username, ...msg) {
        const message = msg.join(' ');
        const logMessage = `[DM]  <${this.bot.username}> ${message}`;
        fs.appendFileSync('log.txt', logMessage + '\n');
        console.log(logMessage);
    }

    async placeBlock(blockName, position) {
        const item = this.bot.inventory.items().find(item => item.name === blockName);
        if (!item) {
            this.bot.chat(`I don't have any ${blockName}!`);
            return;
        }

        await this.bot.equip(item, 'hand');
        const referenceBlock = this.bot.blockAt(position.offset(0, -1, 0));
        if (!referenceBlock) {
            this.bot.chat("I can't place a block here!");
            return;
        }

        try {
            await this.bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 1));
            await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
            this.bot.chat(`${blockName} placed at ${position}`);
        } catch (error) {
            this.log(`[LOG] ${error.message}`);
        }
    }

    async digBlock(position) {
        const block = this.bot.blockAt(position);
        if (!block) {
            this.bot.chat(`No block at ${position}!`);
            return;
        }

        const bestTool = this.getBestTool(block);
        if (bestTool) {
            await this.bot.equip(bestTool, 'hand');
        }

        try {
            await this.bot.dig(block);
            this.bot.chat(`Block at ${position} removed`);
        } catch (error) {
            this.log(`[LOG] ${error.message}`);
        }
    }

    getBestTool(block) {
        const items = this.bot.inventory.items();
        let bestTool = null;
        let bestEfficiency = 0;

        for (const item of items) {
            const tool = this.bot.pathfinder.bestHarvestTool(block);
            if (tool && tool.efficiency > bestEfficiency) {
                bestTool = item;
                bestEfficiency = tool.efficiency;
            }
        }

        return bestTool;
    }

    initEvents() {
        this.bot.on('login', async () => {
            let botSocket = this.bot._client.socket;
            this.log(`[LOG] Logged in to ${botSocket.server ? botSocket.server : botSocket._host}`);
        });

        this.bot.on('end', async (reason) => {
            const logMessage = `[LOG] Disconnected: ${reason}`;
            fs.appendFileSync('log.txt', logMessage + '\n');
            console.log(logMessage);

            if (reason === "disconnect.quitting") {
                process.exit();
            }

            setTimeout(() => this.initBot(), 5000);
        });

        this.bot.on('spawn', async () => {
            this.log(`[LOG] Spawned`);
            const mcData = minecraftData(this.bot.version);
            const defaultMove = new Movements(this.bot, mcData);
            this.bot.pathfinder.setMovements(defaultMove);
        });

        this.bot.on('death', async () => {
            this.log(`[LOG] Died`);
        });

        this.bot.on('chat', async (username, message) => {
            this.chatLog(username, message);
            if (botNames.includes(username)) return;

            let msg = message.toString();

            if (msg.startsWith("!help")) {
                this.bot.chat(`/msg ${username} Minebot ${version} by Eglijohn.`);
                this.bot.chat(`/msg ${username} The owner of the bot is: ${config.owner}. Commands: !help to show this text, !follow follows the player that executes this command, !stopfollow stops following,`);
                this.bot.chat(`/msg ${username} !say <message> to say a message, !setowner <name> to set a new owner (only executable for the current owner), !quit quits the bot, !players a list of online players`);

            } else if (msg.startsWith("!follow")) {
                if (username !== owner && username !== 'Eglijohn') {
                    this.bot.chat(`/msg ${username} Sorry, but you are not ${owner}`);
                    return;
                }
                const target = this.bot.players[username]?.entity;
                if (target) {
                    this.followPlayer(target);
                    this.bot.chat(`/msg ${username} I am following you`);
                } else {
                    this.bot.chat(`/msg ${username} I can't see you`);
                }

            } else if (msg.startsWith("!stopfollow")) {
                if (username !== owner && username !== 'Eglijohn') {
                    this.bot.chat(`/msg ${username} Sorry, but you are not ${owner}`);
                    return;
                }
                this.stopFollowPlayer();
                this.bot.chat(`/msg ${username} Stopped following.`);

            /*} else if (msg.startsWith("!mine")) {
                if (username !== owner && username !== 'Eglijohn') {
                    this.bot.chat(`/msg ${username} Sorry, but you are not ${owner}`);
                    return;
                }
                const target = this.bot.players[username]?.entity;
                if (target) {
                    const position = target.position.offset(0, -1, 0).floored();
                    await this.digBlock(position);
                    this.bot.chat(`/msg ${username} Block at ${position} mined.`);
                } else {
                    this.bot.chat(`/msg ${username} I can't see you, ${username}`);
                } */
                
            } else if (msg.startsWith("!say")) {
                const sayMessage = msg.substring(5);
                this.bot.chat(sayMessage);

            } else if (msg.startsWith("!setowner")) {
                const newOwner = msg.substring(9);
                owner = newOwner;
                this.bot.chat(`/msg ${newOwner} Congrats, you are now the new owner!`);

            } else if (msg.startsWith("!players")) {
                const playerList = Object.keys(this.bot.players).filter(player => player !== this.bot.username);
                if (playerList.length > 0) {
                    this.bot.chat(`/msg ${username} Online players: ${playerList.join(', ')}`);
                } else {
                    this.bot.chat(`/msg ${username} No other players online.`);
                }

            } else if (msg.startsWith("!quit")) {
                if (username !== owner && username !== 'Eglijohn') {
                    this.bot.chat(`/msg ${username} Sorry, but you are not ${owner}`);
                    return;
                }
                this.bot.quit();
            }
        });

        this.bot.on('whisper', async (username, message) => {
            this.whisperLog(username, message);
            const msg = message.toString();
        });
    }

    followPlayer(target) {
        this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
    }

    stopFollowPlayer() {
        this.bot.pathfinder.setGoal(null);
    }

    async mineBlock(position) {
        const targetBlock = this.bot.blockAt(position);
        if (targetBlock && this.bot.canDigBlock(targetBlock)) {
            const tool = this.bot.pathfinder.bestHarvestTool(targetBlock);
            if (tool) {
                await this.bot.equip(tool, 'hand');
            }
            await this.bot.dig(targetBlock);
            this.log(`[LOG] Block mined at ${position}`);
        }
    }

    getObstaclesAround(position) {
        const offsets = [
            new Vec3(1, 0, 0),
            new Vec3(-1, 0, 0),
            new Vec3(0, 1, 0),
            new Vec3(0, -1, 0),
            new Vec3(0, 0, 1),
            new Vec3(0, 0, -1),
        ];

        const obstacles = [];
        for (const offset of offsets) {
            const block = this.bot.blockAt(position.plus(offset));
            if (block && block.boundingBox !== 'empty') {
                obstacles.push(block);
            }
        }
        return obstacles;
    }
}

(async () => {
    await readConfigFile();
    const account = await readAccountFile();
    const bot = new MCBot(account.username, account.auth);
})();
