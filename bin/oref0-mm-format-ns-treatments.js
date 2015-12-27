#!/usr/bin/env node

/*
  Format Pump history to Nightscout treatment events

  Released under MIT license. See the accompanying LICENSE.txt file for
  full terms and conditions

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.

*/

var _ = require('lodash');
var moment = require('moment');
var find_insulin = require('oref0/lib/temps');
var find_bolus = require('oref0/lib/bolus');
var describe_pump = require('oref0/lib/pump');

var ignoreEventTypes = ['BasalProfileStart'];

if (!module.parent) {
    
    var pump_history = process.argv.slice(2, 3).pop();
    var pump_model = process.argv.slice(3, 4).pop();
    var last_time = process.argv.slice(4, 5).pop();
    
    if (last_time) { last_time = moment(last_time); }
    
    if (!pump_history || !pump_model) {
        console.log('usage: ', process.argv.slice(0, 2), '<pump_history.json> <pump_model.json> [filter_time]');
        process.exit(1);
    }
    
    var cwd = process.cwd();
    var pump_history_data = require(cwd + '/' + pump_history);
    var pump_model_data = require(cwd + '/' + pump_model);

	var treatments = find_insulin(find_bolus(pump_history_data));
	treatments = describe_pump(treatments);

	var processed = [];
	
	// Sort events by priority, so merging will always have the right top event
	
	_.sortBy(treatments,function(event) {
		var rank = {
        "Bolus" : 1,
        "TempBasal" : 2,
        "BGReceived" : 3,
        "CalBGForPH" : 4,
        "BolusWizard" : 5,
        "BasalProfileStart" : 6,
        "TempBasalDuration" : 7
    	};
		
		return rank[event._type] ? rank[event._type] : 8;
		
	});
    
    _.forEachRight(treatments,function(n) {

		// filter out events if timestamp was defined

    	var eventTime = moment(n.timestamp);    
		if (last_time && !eventTime.isAfter(last_time)) { return; }

		// filter out undesired event types

    	if (_.includes(ignoreEventTypes,n._type)) { return; }

		// data correction to match Nightscout expectations

		n.created_at = n.created_at ? n.created_at : n.timestamp;
  		n.enteredBy = 'openaps://medtronic/' + pump_model_data;
  		if (n.glucose && !n.glucoseType && n.glucose > 0) { n.glucoseType = n.enteredBy; }
  		n.eventType = (n.eventType ? n.eventType : 'Note');
  		if (n._type == "Bolus" && n.amount && !n.insulin) { this.eventType = 'Correction Bolus'; n.insulin = n.amount;}
  		if (n.carb_input && !n.carbs) {n.carbs = n.carb_input;}
  		if (n.bg == 0) { delete n.bg; } // delete 0 BG
  		if (n._type == 'CalBGForPH' || n._type == 'BGReceived') { n.type = 'BG Check'; this.bg = this.amount; }
  		if (n.eventType == 'Note') { n.notes = n._type + pump_model_data + (n.notes ? n.notes : '');}

  		// merge events happening within 1 minute
    	
    	var foundEventToMergeWith = null;
    	
    	 _.forEachRight(processed,function(m) {
    	 	var event2Time = moment(m.timestamp);
    	 	
    	 	if (eventTime.diff(event2Time) <= 60*1000) {
    	 		foundEventToMergeWith = m;
  	 		}
    		 });
    	
    	// contain all source objects inside the processed objects
    	
    	if (foundEventToMergeWith) {
    		if (!foundEventToMergeWith.containedEvents) { foundEventToMergeWith.containedEvents = []; }
    		foundEventToMergeWith.containedEvents.push(n);
    		
    		for (var property in n) {
				if (n.hasOwnProperty(property)) {
					if (!foundEventToMergeWith.hasOwnProperty(property)) {
        				foundEventToMergeWith[property] = n[property];
        			}
    			}
			}
    	} else {
    		processed.push(n);
    	}

    });

	console.log(JSON.stringify(processed, null, 2));

}
