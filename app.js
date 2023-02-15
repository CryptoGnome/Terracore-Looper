const mongodb = require('mongodb');
const hive = require('@hiveio/hive-js');
require('dotenv').config();

const MongoClient = mongodb.MongoClient;
const url = process.env.MONGO_URL;
const dbName = 'terracore';
const SYMBOL = 'SCRAP';



async function getPlayers(){
    const client = await MongoClient.connect(url);
    const db = client.db(dbName);
    const collection = db.collection('players');
    const players = await collection.find({}).toArray();
    client.close();
    return players;
}

async function fetchBalance(username) {
    const response = await hive.api.getAccountsAsync([username]);
    return parseFloat(response[0].balance);       
}

async function engineBalance(username) {
    //make a list of nodes to try
    const nodes = ["https://engine.rishipanthee.com", "https://herpc.dtools.dev", "https://api.primersion.com"];
    var node;

    //try each node until one works, just try for a response
    for (let i = 0; i < nodes.length; i++) {
        try {
            const response = await fetch(nodes[i], {
                method: "GET",
                headers:{'Content-type' : 'application/json'},
            });
            const data = await response.json()
            node = nodes[i];
            break;
        } catch (error) {
            console.log(error);
        }
    }

                

    const response = await fetch(node + "/contracts", {
      method: "POST",
      headers:{'Content-type' : 'application/json'},
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "find",
        params: {
          contract: "tokens",
          table: "balances",
          query: {
            "account":username,
            "symbol":SYMBOL    
          }
        },
        "id": 1,
      })
    });
    const data = await response.json()
    if (data.result.length > 0) {
        return [parseFloat(data.result[0].balance), parseFloat(data.result[0].stake)];
    } else {
        return 0;
    }
}

//sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function main(){
    //get list of players
    const players = await getPlayers();
    //loop through players
    for (let i = 0; i < players.length; i++) {
        const client = await MongoClient.connect(url);
        const db = client.db(dbName);
        const collection = db.collection('players');
        
        console.log("checking " + players[i].username);
        if (players[i].cooldown < Date.now()) {
            //fetch balance and add to player
            players[i].balance = await fetchBalance(players[i].username);
            //fetch engine balance and add to player
            var engine = await engineBalance(players[i].username);

            if (engine == 0) {
                players[i].hiveEngineScrap = 0;
                players[i].hiveEngineStake = 0;
            } 
            else {
                players[i].hiveEngineScrap = await engine[0];
                players[i].hiveEngineStake = await engine[1];
            }

            var stashsize = players[i].hiveEngineStake + 1;

            //make sure the last cooldown is  greater than 15 seconds ago
            if (players[i].cooldown < (Date.now() - 15000)) {

                //if staked scrap is 0 you can only 1 scrap 
                if (stashsize == 1) {
                    //allow user to mine up to 1 scrap at mine rate
                    if (players[i].scrap <= 1) {
                        //add scrap if it is less than 1 else set scrap to 1
                        if ((players[i].scrap + players[i].minerate * ((Date.now() - players[i].cooldown) / 1000)) < 1) {
                            players[i].scrap += players[i].minerate * ((Date.now() - players[i].cooldown) / 1000);
                            players[i].cooldown = Date.now();
                        }
                        else {
                            players[i].scrap = 1;
                            players[i].cooldown = Date.now();
                        }
                    }

                }
                else {
                    //check if scrap is less than stashsize
                    if (players[i].scrap <= (stashsize + (players[i].minerate * ((Date.now() - players[i].cooldown) / 1000)))) {
                        //add scrap if it is less than stashsize else set scrap to stashsize
                        if ((players[i].scrap + players[i].minerate * ((Date.now() - players[i].cooldown) / 1000)) < stashsize) {
                            players[i].scrap += players[i].minerate * ((Date.now() - players[i].cooldown) / 1000);
                            players[i].cooldown = Date.now();
                        }
                        else {
                            players[i].scrap = stashsize;
                            players[i].cooldown = Date.now();
                        }
                    }
                    else {
                        players[i].cooldown = Date.now();
                    }
                }

                //check if regen is needed
                if (players[i].lastregen < Date.now() - 14400000 && players[i].attacks < 8) {
                    //find how many hours since last regen
                    let hours = Math.floor((Date.now() - players[i].lastregen) / 3600000);
                    //give 1 regen per 4 hours
                    //make sure attacks does not go over 8
                    if (players[i].attacks + parseInt(hours / 4) > 8) {
                        players[i].attacks = 8;
                    }
                    else {
                        players[i].attacks += parseInt(hours / 4);
                        players[i].lastregen = Date.now();
                    }
                }

                //check if lastclaim needs recharge once every 4 hours
                if (players[i].lastclaim < Date.now() - 14400000 && players[i].claims < 5) {
                    //check how many hours since last claim
                    let hours = Math.floor((Date.now() - players[i].lastclaim) / 3600000);
                    //give 1 claim per 4 hours
                    players[i].claims += parseInt(hours / 4);
                    //make sure claims does not go over 5
                    if (players[i].claims > 5) {
                        players[i].claims = 5;
                    }
                    players[i].lastclaim = Date.now();
                    
                }

                //only update changes to scrap, cooldown, claims, attacks, lastregen, lastclaim
                collection.updateOne({username: players[i].username}, {$set: {scrap: players[i].scrap, cooldown: players[i].cooldown, claims: players[i].claims, attacks: players[i].attacks, lastregen: players[i].lastregen, lastclaim: players[i].lastclaim, hiveEngineScrap: players[i].hiveEngineScrap, hiveEngineStake: players[i].hiveEngineStake}}, function(err, res) {
                    if (err) throw err;
                    console.log("updated " + players[i].username);
                    client.close();
                });
            } 
            else {
                console.log("cooldown not ready for " + players[i].username);
            }
        }
    }
    
    //after all players are updated, sleep for 5 seconds then run main again
    await sleep(60000);
    main();



}


//run main every 5 seconds
main();
