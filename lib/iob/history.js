
var tz = require('timezone');

function calcTempTreatments (inputs) {
  var pumpHistory = inputs.history;
  var profile_data = inputs.profile;
    var tempHistory = [];
    var tempBoluses = [];
    var now = new Date();
    for (var i=0; i < pumpHistory.length; i++) {
        var current = pumpHistory[i];
        //if(pumpHistory[i].date < time) {
            if (pumpHistory[i].type == "Bolus") {
                console.log(pumpHistory[i]);
                var temp = {};
                temp.timestamp = current.start_at;
                //temp.started_at = new Date(current.date);
                temp.started_at = new Date(tz(current.start_at));
                //temp.date = current.date
                temp.date = temp.started_at.getTime();
                temp.insulin = current.amount;
                tempBoluses.push(temp);
            } else if (pumpHistory[i].type == "TempBasal") {
                // test for percent basal: '%' character in description
                if (current.description.indexOf('%') !== -1) {
                    continue;
                }
                var normalizedRate = pumpHistory[i].amount;
                var temp = {};
                temp.normalizedRate = normalizedRate;
                //temp.date = date;
                temp.timestamp = current.start_at;
                //temp.started_at = new Date(temp.date);
                temp.started_at = new Date(tz(temp.timestamp));
                temp.date = temp.started_at.getTime();
                var end_at = new Date(tz(current.end_at));
                temp.duration = (end_at.getTime() - temp.date)/60/1000;
                tempHistory.push(temp);
            }
        //}
    }
    // to do: check if mmhistorytools guarantees sorted basals: if so remove the following line
    tempHistory.sort(function (a, b) { if (a.date > b.date) { return 1 } if (a.date < b.date) { return -1; } return 0; });
    // to do: check if mmhistorytools guarantees non-overlapping basals: if so remove the following block
    for (var i=0; i+1 < tempHistory.length; i++) {
        if (tempHistory[i].date + tempHistory[i].duration*60*1000 > tempHistory[i+1].date) {
            tempHistory[i].duration = (tempHistory[i+1].date - tempHistory[i].date)/60/1000;
        }
    }
    var tempBolusSize;
    var now = new Date();
    for (var i=0; i < tempHistory.length; i++) {
        if (tempHistory[i].duration > 0) {
            var netBasalRate = tempHistory[i].normalizedRate;
            if (netBasalRate < 0) { tempBolusSize = -0.05; }
            else { tempBolusSize = 0.05; }
            var netBasalAmount = Math.round(netBasalRate*tempHistory[i].duration*10/6)/100
            var tempBolusCount = Math.round(netBasalAmount / tempBolusSize);
            var tempBolusSpacing = tempHistory[i].duration / tempBolusCount;
            for (var j=0; j < tempBolusCount; j++) {
                var tempBolus = {};
                tempBolus.insulin = tempBolusSize;
                tempBolus.date = tempHistory[i].date + j * tempBolusSpacing*60*1000;
                tempBolus.created_at = new Date(tempBolus.date);
                tempBoluses.push(tempBolus);
            }
        }
    }
    var all_data =  [ ].concat(tempBoluses).concat(tempHistory);
    all_data.sort(function (a, b) { return a.date > b.date });
    return all_data;
}
exports = module.exports = calcTempTreatments;