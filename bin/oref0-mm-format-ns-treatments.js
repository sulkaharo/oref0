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

function isTempBasal(event) {
	return (event._type == 'TempBasalDuration' || event._type == 'TempBasal');
}

if (!module.parent) {
    
    var pump_history = process.argv.slice(2, 3).pop();
    var pump_model = process.argv.slice(3, 4).pop();
    var pump_status = process.argv.slice(4, 5).pop();
    var last_time = process.argv.slice(5, 6).pop();
    
    if (last_time) { last_time = moment(last_time); }
    
    if (!pump_history || !pump_model) {
        console.log('usage: ', process.argv.slice(0, 2), '<pump_history.json> <pump_model.json> <pump_status.json> [filter_time]');
        process.exit(1);
    }
    
    var cwd = process.cwd();
//    var pump_history_data = require(cwd + '/' + pump_history);

	var fs = require("fs");
	var contents = fs.readFileSync(cwd + '/' + pump_history, "utf8");
	var pump_history_data = JSON.parse(contents.replace("2000-","2016-"));

    var pump_model_data = require(cwd + '/' + pump_model);
    var pump_status_data = require(cwd + '/' + pump_status);

	// don't process events during a bolus, due to Bolus Wizard events split to multiple events

	if (pump_status_data.bolusing != false) return;

	var treatments = find_insulin(find_bolus(pump_history_data));
	treatments = describe_pump(treatments);

	var processed = [];
	
	// Sort events by priority, so merging will always have the right top event
	
	var rank = {
	"Bolus" : 1,
	'Meal Bolus': 1,
	"Temp Basal" : 2,
	"TempBasal" : 2,
	"BGReceived" : 3,
	"CalBGForPH" : 4,
	"BG Check": 4,
	"BolusWizard" : 5,
	"BasalProfileStart" : 6,
	"TempBasalDuration" : 7
	};

	_.sortBy(treatments,function(event) {

		// Fix some wrongly mapped event types
		// TODO: figure out why the event types are wrong in the first place
		if (event.eventType == '<none>') {
			if (event.insulin) { event.eventType = 'Bolus'; }
			if (event._type == 'CalBGForPH') { event.eventType = 'BG Check'; }
		}
		
		var type = event.eventType ? event.eventType : event._type;
		return rank[event._type] ? rank[event._type] : 8;
		
	});
    
    _.forEach(treatments,function(n) {

		// filter out events if timestamp was defined

    	var eventTime = moment(n.timestamp); 
		if (last_time && !eventTime.isAfter(last_time)) { return; }
		
		// To prevent multi-part events from being uploaded in parts, do not process events that are 
		// more recent than 60 seconds old. which can't also be merged to something older

		if (moment().diff(eventTime,'seconds') < -60) {
			var foundRecentMergeableEvent = false;
			 _.forEach(treatments,function(n) {
			 	if (eventTime.diff(moment(n.timestamp)) <= -60) { foundRecentMergeableEvent = true; }
			 });
			 
			 if (!foundRecentMergeableEvent) { return; }
		}

		// filter out undesired event types

    	if (_.includes(ignoreEventTypes,n._type)) { return; }

		// TODO: add support for "Prime" event -> site change?

		// data correction to match Nightscout expectations

		n.created_at = n.created_at ? n.created_at : n.timestamp;
  		n.enteredBy = 'openaps://medtronic/' + pump_model_data;
  		if (n._type == "Bolus" && n.amount && !n.insulin) { this.eventType = 'Correction Bolus'; n.insulin = n.amount;}
  		if (n.carb_input && !n.carbs) {n.carbs = n.carb_input;}
  		if (n.bg == 0) { delete n.bg; } // delete 0 BG
		if (n.bg) { n.units = 'mgdl'; n.glucose = n.bg; }  // everything from Decocare should be in mg/dl
  		if (n._type == 'CalBGForPH' || n._type == 'BGReceived') { n.eventType = 'BG Check'; this.glucose = this.amount; }
  		if (n.glucose && !n.glucoseType && n.glucose > 0) { n.glucoseType = n.enteredBy; }
  		n.eventType = (n.eventType ? n.eventType : 'Note');
  		if (n.eventType == 'Note') { n.notes = n._type + pump_model_data + (n.notes ? n.notes : '');}

  		// merge events happening within 1 minute
    	
    	var foundEventToMergeWith = null;
    	
    	 _.forEachRight(processed,function(m) {
    	 	var event2Time = moment(m.timestamp);
    	 	
    	 	if (Math.abs(eventTime.diff(event2Time)) <= 60*1000) {
    	 		
    	 		// only merge Temp Basals with Temp Basals
    	 		// TODO: make data driven - configure mergeable and/or unmergeable event combos
    	 		
    	 		if (isTempBasal(n) && !isTempBasal(m)) { return; }
	    	 	
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
    
    // Sort by timestamp for upload
    
    _.sortBy(processed, function(event) {
    	//element will be each array, so we just return a date from first element in it
    	return event.timestamp;
	});

	console.log(JSON.stringify(processed, null, 2));

}
