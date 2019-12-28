const aws = require('aws-sdk');
var dynamo = new aws.DynamoDB.DocumentClient ({
    region: 'ap-northeast-1'
});
const LINE_TOKEN = process.env['LINE_TOKEN'];

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
    
    if (repToken == '00000000000000000000000000000000') {
        context.succeed(createResponse(200, 'Completed successfully !!'));
        console.log("Success: Response completed successfully !!");
    } else {
        if (reqText.match(/ありがと/)) {
            replyText(repToken, "これくらい全然いいよ♪").then(() => {
                context.succeed(createResponse(200, 'Completed successfully'));
            })
        }
        if (reqText === "今月" || reqText === "今日") {
            getTotalAmount(botid, reqText).then((total) => {
                replyText(repToken, reqText + "は" + total + "円").then(() => {
                    context.succeed(createResponse(200, 'Completed successfully'));
                });
            })
        } else {
            getIncompleteItems(botid).then((items) => {
                if (items.length == 0) {
                    if (isNaN(reqText)) {
                        replyText(repToken, "「" + reqText + "」じゃいくら使ったかわからん。ちゃんと教えてくれん？").then(() => {
                            context.succeed(createResponse(200, 'Completed successfully'));
                        });
                    } else {
                        getNewSeq("cost").then((id) => {
                            return registerAmount(id, botid, reqText);
                        })
                        .then((amount) => {
                            return replyText(repToken, amount + "円ね。で、ちなみに何に使ったん？");
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
                        updateAndregisterKind(items[0].id, reqText).then((kind) => {
                            return replyText(repToken, "「" + kind + "」ね。分かった。登録したよ！");
                        })
                        .then(() => {
                            context.done(null);
                        });
                    } 
                } else {
                    replyText(repToken, "まだ用途を言ってないものあるよね？").then(() => {
                        context.succeed(createResponse(200, 'Completed successfully'));
                    });
                }
            })
            .catch(() => {
                console.log("失敗");
            });
        }
        
    }
};

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

function getIncompleteItems(userId) {
    const date = new Date();
    const today = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();

    return new Promise((resolve, reject) => {
        const param = {
            TableName: "cost",
            FilterExpression: "begins_with(#createAt, :d) and #isComplete = :c and #userId = :u",
            ExpressionAttributeNames: {
                "#createAt": "createAt",
                "#isComplete": "isComplete",
                "#userId": "userId"
            },
            ExpressionAttributeValues: {
                ":d": today,
                ":c": false,
                ":u": userId
            }
        };
        dynamo.scan(param, (err,data) => {
            if(err) {
                console.log("Fail Scan", JSON.stringify(err, null, 2));
            } else {
                resolve(data.Items);
            }
        });
    });
}

function getNewSeq(seqName) {
    return  new Promise((resolve, reject) => {
        const params = {
            TableName: "sequences",
            Key: {
                name: seqName
            },
            UpdateExpression: "set currentNumber = currentNumber + :val",
            ExpressionAttributeValues: {
                ":val": 1
            },
            ReturnValues: "UPDATED_NEW"
        };
        dynamo.update(params, (err, data) => {
            if (err) {
                console.error('Unable to update item. Error JSON:', JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log('UpdateItem succeeded:', JSON.stringify(data, null, 2));
                resolve(data.Attributes.currentNumber);
            }
        });
    });
}

function registerAmount(id, userId, amount) {
    const date = new Date();
    const createAt = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + " " + (date.getHours()) + ":"+date.getMinutes() + ":" + date.getSeconds();
    const today = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();

    return new Promise((resolve, reject) => {
        dynamo.put({
         "TableName": "cost",
         "Item": {
            "id": id,
            "userId": userId,
            "createAt": createAt,
            "date": today,
            "purpose": {
                "amount": amount
            },
            "isComplete": false
         }
    }, (err, data) => {
            if(!err) {
                resolve(amount);
            } else {
                console.log("dynamo_err:", err);
            }
        });
    });
}

function updateAndregisterKind(id, kind) {

    return new Promise((resolve, reject) => {
        const params = {
            TableName: "cost",
            Key: {
                "id": id,
            },
            UpdateExpression: "set isComplete = :c, purpose.kind = :k",
            ExpressionAttributeValues: {
                ":c": true,
                ":k": kind
            },
            ReturnValues:"UPDATED_NEW"
        };
        console.log("Updating the item...");
        dynamo.update(params, (err, data) => {
            if (err) {
                console.error(console.log("Unable to update item. Error JSON:", JSON.stringify(err, null, 2)));
            } else {
                console.log("UpdateItem succeeded:", JSON.stringify(data, null, 2));
                resolve(kind);
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
                date = today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate();
            case "今月":
                date = today.getFullYear() + "-" + (today.getMonth() + 1);
            default:
                date = today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate();
        }
        const param = {
            TableName: "cost",
            FilterExpression: "#userId = :userId and begins_with(#date, :date)",
            ExpressionAttributeNames: {
                "#userId": "userId",
                "#date": "date"
            },
            ExpressionAttributeValues: {
                ":userId": userId,
                ":date": date
            }
        };
        dynamo.scan(param, (err, data) => {
            if (err) {
                console.log("Fail Scan", JSON.stringify(err, null, 2));
            } else {
                let total = 0;
                data.Items.forEach((item) => {
                    total += Number(item.purpose.amount);
                });
                console.log("total", total);
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