const aws = require('aws-sdk');
var dynamo = new aws.DynamoDB.DocumentClient ({
    region: 'ap-northeast-1'
});
const dateUtils = require('date-utils');
const houseHold = "HouseHold";
const LINE_TOKEN = process.env['LINE_TOKEN'];
const BOT_ID = process.env['BOT_ID'];

const createResponse = (statusCode, body) => {
    return {
        statusCode: statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(body)
    };
};

exports.handler = (event, context) => {
    console.log(event);
    
    const botid = event.destination;
    const reqText = event.events[0].message.text;
    const repToken = event.events[0].replyToken;
    const userId = event.events[0].source.userId;
    const messageId = event.events[0].message.id;
    
    if (botid !== BOT_ID) {
        context.done(null);
        return;
    } else {
        // LINEコンソールからの検証用
        if (repToken == '00000000000000000000000000000000') {
            context.succeed(createResponse(200, 'Completed successfully !!'));
            console.log("Success: Response completed successfully !!");
        } else {
            // 通常利用時処理
            if (reqText.match(/ありがと/)) {
                replyText(repToken, "これくらい全然いいよ♪").then(() => {
                    context.succeed(createResponse(200, 'Completed successfully'));
                });
            } else if (reqText === "今月" || reqText === "今日" || reqText == "先月") {
                getTotalAmount(userId, reqText).then((total) => {                   
                    replyText(repToken, createTotalText(total, reqText)).then(() => {
                        context.succeed(createResponse(200, 'Completed successfully'));
                    });
                });
            } else {
                getIncompleteItems(userId, messageId).then((items) => {
                    if (items.length == 0) {
                        if (isNaN(reqText)) {
                            replyText(repToken, "「" + reqText + "」じゃいくら使ったかわからん。ちゃんと教えてくれん？").then(() => {
                                context.succeed(createResponse(200, 'Completed successfully'));
                            });
                        } else {
                            registerAmount(userId, messageId, reqText).then(() => {
                                return replyText(repToken, reqText + "円ね。で、ちなみに何に使ったん？");
                            })
                            .then(() => {
                                context.succeed(createResponse(200, 'Completed successfully'));
                            });
                        }
                    } else if (items.length == 1){
                        if (!isNaN(reqText)) {
                            replyText(repToken, "「" + reqText + "」じゃ何に使ったかわからん。ちゃんと教えてくれん？").then(() => {
                                context.succeed(createResponse(200, 'Completed successfully'));
                            });
                        } else {
                            if (reqText === "キャンセル") {
                                cancel(userId, items[0].messageId).then(() => {
                                    return replyText(repToken, "キャンセルしたよ〜");
                                }).then(() => {
                                    context.done(null);
                                });
                            } else {
                                updateAndregisterKind(userId, items[0].messageId, reqText).then((kind) => {
                                    return replyText(repToken, "「" + kind + "」ね。分かった。登録したよ！");
                                }).then(() => {
                                    context.done(null);
                                });
                            }
                        } 
                    } else {
                        replyText(repToken, "まだ用途を言ってないものあるよね？").then(() => {
                            context.succeed(createResponse(200, 'Completed successfully'));
                        });
                    }
                })
                .catch(() => {
                    console.log("失敗");
                    context.done(null);
                });
            }
            
        }
    }
    
};

// 合計金額リストのテキスト生成
function createTotalText(total, reqText) {
    let totalText = reqText + "は" + total.totalAmount + "円\n\n";
    total.purposes.forEach((purpose) => {
        totalText += purpose.kind + " : " + purpose.amount + "円\n";
    });

    if (total.totalAmount === 0) {
        return totalText.slice(0, -2);
    } else {
        return totalText.slice(0, -1);
    }    
}

// 返信処理
function replyText(repToken, res) {
    return new Promise((resolve, reject) => {
        const request = require('request');
        
        let options = {
            uri: 'https://api.line.me/v2/bot/message/reply',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${LINE_TOKEN}`
            },
            json: {
                "replyToken":repToken,
                "messages": [
                    {
                        "type": "text",
                        "text": res
                    }
                ]
            }
        };
        request.post(options, (error, response, body) => {
            if(!error) {
                console.log('Success: Communication successful completion !!');
                resolve();
            } else {
                console.log(`Failed: ${error}`);
                resolve();
            }
        });
    });
}

//用途未登録の項目を取得
function getIncompleteItems(userId) {

    return new Promise((resolve, reject) => {
        const param = {
            TableName: houseHold,
            IndexName: "isCompleteIndex",
            ConsistentRead: false,
            KeyConditionExpression: "#userId = :userId and #isComplete = :isComplete",
            FilterExpression: "#hasCancel = :hasCancel",
            ExpressionAttributeNames: {
                "#userId": "userId",
                "#isComplete": "isComplete",
                "#hasCancel": "hasCancel"
            },
            ExpressionAttributeValues: {
                ":userId": userId,
                ":isComplete": 0,
                ":hasCancel": 0
            }
        };
        dynamo.query(param, (err, data) => {
            if (err) {
                console.error(console.log("Unable to query item. Error JSON:", JSON.stringify(err, null, 2)));
                reject();
            } else {
                console.log("QueryItem Succeed:", JSON.stringify(data, null, 2));
                resolve(data.Items);
            }
        });
    });
}

// 金額登録
function registerAmount(userId, messageId, reqText) {
    return new Promise((resolve, reject) => {
        dynamo.put({
         "TableName": houseHold,
         "Item": {
            "userId": userId,
            "messageId": messageId,
            "createAt": new Date().toFormat("YYYY-MM-DD HH24:MI:SS"),
            "isComplete": 0,
            "hasCancel": 0,
            "purpose": {
                "amount": reqText
            }
         }
    }, (err, data) => {
            if(err) {
                console.log("dynamo_err:", err);
            } else {
                resolve();
            }
        });
    });
}

// 用途登録の更新処理
function updateAndregisterKind(userId, messageId, kind) {

    return new Promise((resolve, reject) => {
        const param = {
            TableName: houseHold,
            Key: {
                "userId": userId,
                "messageId": messageId
            },
            UpdateExpression: "set isComplete = :isComplete, purpose.kind = :kind, createAt = :createAt",
            ExpressionAttributeValues: {
                ":isComplete": 1,
                ":kind": kind,
                ":createAt": new Date().toFormat("YYYY-MM-DD HH24:MI:SS")
            },
            ReturnValues:"UPDATED_NEW"
        };
        console.log("Updating the item...");
        dynamo.update(param, (err, data) => {
            if (err) {
                console.error(console.log("Unable to update item. Error JSON:", JSON.stringify(err, null, 2)));
            } else {
                console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
                resolve(kind);
            }
        });
    });
}

// キャンセルによる項目削除
function cancel(userId, messageId) {
    return new Promise((resolve, reject) => {
        const param = {
            TableName: houseHold,
            Key: {
                "userId": userId,
                "messageId": messageId
            },
            UpdateExpression: "set isComplete = :isComplete, hasCancel = :hasCancel, createAt = :createAt",
            ExpressionAttributeValues: {
                ":isComplete": 1,
                ":hasCancel": 1,
                ":createAt": new Date().toFormat("YYYY-MM-DD HH24:MI:SS")
            },
            ReturnValues: "UPDATED_NEW"
        };
        console.log("Updating the item...");
        dynamo.update(param, (err, data) => {
            if (err) {
                console.error(console.log("Unable to update item. Error JSON:", JSON.stringify(err, null, 2)));
                reject();
            } else {
                console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
                resolve();
            }
        });
    });
}

function getTotalAmount(userId, reqText) {
    return new Promise((resolve, reject) => {
        let date = "";
        const today = new Date();
        switch (reqText) {
            case "今日":
                date = today.toFormat("YYYY-MM-DD");
                break;
            case "今月":
                date = today.toFormat("YYYY-MM");
                break;
            case "先月":
                const month = today.getMonth() + 1;
                today.setMonth(month - 2);
                date = today.toFormat("YYYY-MM");
                break;
            default:
                date = today.getFullYear() + "-" + (today.getMonth() + 1);
                break;
        }
        console.log(date);
        const param = {
            TableName: houseHold,
            IndexName: "createAtIndex",
            ConsistentRead: false,
            KeyConditionExpression: "#userId = :userId and begins_with(#createAt, :createAt)",
            FilterExpression: "#isComplete = :isComplete and #hasCancel = :hasCancel",
            ExpressionAttributeNames: {
                "#userId": "userId",
                "#createAt": "createAt",
                "#isComplete": "isComplete",
                "#hasCancel": "hasCancel"
            },
            ExpressionAttributeValues: {
                ":userId": userId,
                ":createAt": date,
                ":isComplete": 1,
                ":hasCancel": 0
            }
        };
        dynamo.query(param, (err, data) => {
            if (err) {
                console.error(console.log("Unable to query item. Error JSON:", JSON.stringify(err, null, 2)));
                reject();
            } else {
                let total = {
                    term: date,
                    totalAmount: 0,
                    purposes: []
                };
                data.Items.forEach((item) => {
                    total.totalAmount += Number(item.purpose.amount);
                    total.purposes.push({
                        amount: item.purpose.amount,
                        kind: item.purpose.kind,
                        createAt: item.purpose.createAt
                    });
                });
                total.purposes.sort((a, b) => {
                    if (a.createAt > b.createAt) {
                        return -1;
                      }
                      else if (a.createAt < b.createAt) {
                        return 1;
                      }
                      else {
                        return 0;
                      }
                });
                resolve(total);
            }
        });
    });
}
/*
function replyPostBackAction(repToken) {
    return new Promise((resolve, reject) => {
        const request = require('request');

        let options = { 
            uri: 'https://api.line.me/v2/bot/message/reply',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${LINE_TOKEN}`
            },
            json: {
                "replyToken": repToken,
                "messages": [
                    {
                        "quickReply": {
                            "items": [
                                {
                                    "type": "action",
                                    "action": {
                                        "type": "message",
                                        "label": "食費",
                                        "text": "食費"
                                    }
                                },
                                {
                                    "type": "action",
                                    "action": {
                                        "type": "message",
                                        "label": "タバコ",
                                        "text": "タバコ"
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        };
        request.post(options, (error, response, body) => {
            if(!error) {
                console.log('Success: Communication successful completion !!');
                resolve();
            } else {
                console.log(`Failed: ${error}`);
                resolve();
            }
        });
    });
}
*/