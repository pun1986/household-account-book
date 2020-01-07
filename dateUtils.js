require('date-utils');

exports.date = ((term) => {
    let date = "";
    const today = new Date();
    switch (term) {
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
        case "昨日":
            const yesterday = Date.yesterday();
            date = yesterday.toFormat("YYYY-MM-DD");
            break;
        default:
            date = today.toFormat("YYYY-MM-DD HH24-MI-SS");
            break;
    }
    return date;
});