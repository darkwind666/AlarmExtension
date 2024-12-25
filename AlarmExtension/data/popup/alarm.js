'use strict';

const alarm = {};
window.alarm = alarm;

const placeholderImage = document.querySelector('.placeholderImage');
placeholderImage.style.display = "none";

alarm.format = (d, time = false) => {
  const day = ({
    0: 'Sun',
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat'
  })[d.getDay()] + ', ' + ('0' + d.getDate()).substr(-2) + ' ' + ({
    0: 'Jan',
    1: 'Feb',
    2: 'Mar',
    3: 'Apr',
    4: 'May',
    5: 'Jun',
    6: 'Jul',
    7: 'Aug',
    8: 'Sep',
    9: 'Oct',
    10: 'Nov',
    11: 'Dec'
  })[d.getMonth()];

  return day + (time ? ' ' + ('0' + d.getHours()).substr(-2) + ':' + ('0' + d.getMinutes()).substr(-2) : '');
};

document.getElementById('plus').addEventListener('click', () => {
  alarm.edit();
});

document.addEventListener('click', e => {
  const {command} = e.target.dataset;

  if (command === 'cancel') {
    document.body.dataset.alarm = 'view';
  }
  else if (command === 'remove') {
    alarm.remove(e.target);
  }
  else if (command) {
    alarm[command]();
  }

});

// helper function to check all days or uncheck all days based on once button
document.querySelector('.alarm [data-id="edit"] [data-id="once"]').onclick = e => {
  const days = [...document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]:checked')];
  if (e.target.checked === false && days.length === 0) {
    for (const e of document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')) {
      e.checked = true;
    }
  }
  if (e.target.checked) {
    for (const e of document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')) {
      e.checked = false;
    }
  }
};

document.querySelector('.alarm div[data-id="content"]').addEventListener('change', ({target}) => {
  const entry = target.closest('.entry');
  if (entry) {
    const jobs = [];
    entry.setAttribute('disabled', target.checked ? false : true);

    chrome.runtime.sendMessage({
      method: 'get-alarms'
    }, alarms => {
      // remove old alarms
      alarms.filter(a => a.name.startsWith(entry.dataset.id)).forEach(a => jobs.push({
        method: 'clear-alarm',
        name: a.name
      }));
      // set new alarms
      if (target.checked) {
        let periodInMinutes = undefined;
        if (entry.querySelector('[data-id=once]').textContent === '') {
          periodInMinutes = entry.querySelector('[data-id=date]').classList.contains('range') ? 7 * 24 * 60 : undefined;
        }

        entry.times.forEach((when, index) => jobs.push({
          method: 'set-alarm',
          info: {
            when,
            periodInMinutes
          },
          name: entry.dataset.id + ':' + index
        }));
      }
      chrome.runtime.sendMessage({
        method: 'batch',
        jobs
      });
    });
  }
});

alarm.convert = (time, ds) => {
  const d = new Date(); // 0 - 6 Sunday is 0, Monday is 1, and so on.

  d.setSeconds(0);
  const day = d.getDay();
  const days = [...ds]; // clone
  if (days.length === 0) {
    days.push(d.getDay());
  }

  return days.map(a => (a - day)).map(n => {
    const o = new Date();
    const of1 = o.getTimezoneOffset();

    o.setDate(d.getDate() + n);
    o.setHours(time.hours, time.minutes, 0);

    // consider timezone changes
    const of2 = o.getTimezoneOffset();
    o.setTime(o.getTime() + (of1 - of2) * 60 * 1000);

    if (o.getTime() - Date.now() < 0) {
      o.setDate(o.getDate() + 7);
    }

    return o.getTime();
  }).filter((n, i, l) => l.indexOf(n) === i).sort();
};

const init = (callback = () => {}) => chrome.runtime.sendMessage({
  method: 'get-alarms'
}, alarms => chrome.storage.local.get({
  'alarms': []
}, prefs => {
  const t = document.querySelector('.alarm template');
  const entries = document.querySelector('.alarm div[data-id="entries"]');

  for (const o of prefs.alarms.sort((a, b) => {
    return a.time.hours * 60 + a.time.minutes - (b.time.hours * 60 + b.time.minutes);
  })) {
    const {id, time, days, once, name} = o;
    const clone = document.importNode(t.content, true);
    
    // time
    clone.querySelector('[data-id="time"]').textContent =
      ('0' + time.hours).substr(-2) + ':' +
      ('0' + time.minutes).substr(-2);

    clone.querySelector('[data-id="AlarmName"]').textContent = name ? ` ${name}` : '';
    
    // Handle once tag visibility
    const onceSpan = clone.querySelector('[data-id="once"]');
    onceSpan.textContent = once ? 'once' : '';
    onceSpan.style.display = once ? '' : 'none'; // Hide if not once
    
    // next occurrence
    const times = alarm.convert(time, days);
    const date = clone.querySelector('[data-id="date"]');
    
    if (days.length > 1) {
      // For multiple days selected, show only first letters
      const map = {
        0: 'S',
        1: 'M',
        2: 'T',
        3: 'W',
        4: 'T',
        5: 'F',
        6: 'S'
      };
      date.textContent = days.map(d => map[d]).join(' ');
      date.classList.add('range');
    } else if (once || days.length === 0 || days.length === 1) {
      // For one-time alarms or single day selection, show full date
      date.textContent = alarm.format(new Date(times[0]));
      date.classList.remove('range');
    }

    const entry = clone.querySelector('.entry');
    entry.times = times;
    entry.o = o;
    entry.dataset.id = id;
    
    // Set alarm as active by default
    entry.setAttribute('disabled', false);
    const checkbox = clone.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    
    // Set up the alarm
    const jobs = [];
    let periodInMinutes = undefined;
    if (!once && days.length > 0) {
      periodInMinutes = 7 * 24 * 60;
    }

    times.forEach((when, index) => jobs.push({
      method: 'set-alarm',
      info: {
        when,
        periodInMinutes
      },
      name: id + ':' + index
    }));

    entries.appendChild(clone);
    
    chrome.runtime.sendMessage({
      method: 'batch',
      jobs
    });
  }
  alarm.toast();
  callback();
}));
init();

alarm.ms2time = duration => ({
  seconds: Math.floor((duration / 1000) % 60),
  minutes: Math.floor((duration / (1000 * 60)) % 60),
  hours: Math.floor((duration / (1000 * 60 * 60)) % 24),
  days: Math.floor((duration / (1000 * 60 * 60 * 24)))
});

function showPlaceholderImage() {
  chrome.storage.local.get({
    alarms: []
  }, prefs => {

    if (prefs.alarms.length) {
      placeholderImage.style.display = "none";
    } else {
      placeholderImage.style.display = "flex";
    }

  });
}

alarm.toast = () => {
  chrome.runtime.sendMessage({
    method: 'get-alarms'
  }, alarms => {
    const times = alarms.map(o => o.scheduledTime);
    showPlaceholderImage()
  });
};

/* edit */
{
  const hours = document.querySelector('.alarm [data-id="edit"] [data-id="hours"]');
  const minutes = document.querySelector('.alarm [data-id="edit"] [data-id="minutes"]');

  const edit = document.querySelector('.alarm [data-id="edit"]');
  const onchange = () => {
    
    // const current = document.querySelector('.alarm [data-id=current]');
    const days = [...document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')]
      .filter(e => e.checked);
    if (days.length === 7) {
      // current.textContent = 'Every day';
    }
    else if (days.length > 1) {
      const map = {
        0: 'Sun',
        1: 'Mon',
        2: 'Tue',
        3: 'Wed',
        4: 'Thu',
        5: 'Fri',
        6: 'Sat'
      };
      // current.textContent = days.map(e => map[e.value]).join(', ');
    }
    else {
      const times = alarm.convert({
        hours: Number(hours.value),
        minutes: Number(minutes.value)
      }, days.map(e => e.value));

      const time = times.shift();
      const n = new Date();
      const d = new Date(time);
      const t = new Date(n.getTime() + 24 * 60 * 60 * 1000);

      // if (d.getDate() === n.getDate()) {
      //   current.textContent = 'Today - ' + alarm.format(d);
      // }
      // else if (d.getDate() === t.getDate()) {
      //   current.textContent = 'Tomorrow - ' + alarm.format(d);
      // }
      // else {
      //   current.textContent = alarm.format(d);
      // }
    }
    if (days.length === 0) {
      document.querySelector('.alarm [data-id="edit"] [data-id="once"]').checked = true;
    }
  };
  edit.addEventListener('change', onchange);
  edit.addEventListener('input', onchange);

  // add leading zeros and force range
  const fix = (e, min = 0, max = 23) => {
    e.target.value = Math.max(min, Math.min(max, e.target.valueAsNumber)).toString().padStart(2, '0');
  };
  hours.addEventListener('change', e => fix(e, 0, 23));
  minutes.addEventListener('change', e => fix(e, 0, 59));

  alarm.save = () => chrome.storage.local.get({
    alarms: []
  }, prefs => {
    const id = document.querySelector('.alarm [data-id="edit"]').dataset.assign;
    const restart = document.querySelector('.alarm [data-id="edit"]').dataset.restart === 'true';
    const ids = prefs.alarms.map(a => a.id);
    const a = {
      id,
      days: [...document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')]
        .filter(e => e.checked).map(e => Number(e.value)),
      time: {
        hours: Math.min(23, Math.max(0, Number(hours.value))),
        minutes: Math.min(59, Math.max(0, Number(minutes.value)))
      },
      once: document.querySelector('.alarm [data-id="edit"] [data-id="once"]').checked,
      name: document.querySelector('.alarm [data-id="edit"] [data-id="name"]').value
    };
  
    const index = ids.indexOf(id);
    if (index === -1) {
      prefs.alarms.push(a);
    }
    else {
      prefs.alarms[index] = a;
    }
    chrome.storage.local.set({
      alarms: prefs.alarms
    }, () => {
      document.querySelector('.alarm div[data-id="entries"]').textContent = '';
      init(() => {
        // Find the newly created/edited alarm entry and set it as active
        const entry = document.querySelector(`.alarm .entry[data-id="${id}"]`);
        if (entry) {
          const checkbox = entry.querySelector('input[type=checkbox]');
          checkbox.checked = true;
          // Trigger the change event to activate the alarm
          checkbox.dispatchEvent(new Event('change', {
            bubbles: true
          }));
        }
      });
      document.body.dataset.alarm = 'view';
    });
  });

  alarm.edit = (o = {
    days: [],
    time: (() => {
      const d = new Date(Date.now() + 30 * 60 * 1000);
      return {
        hours: d.getHours(),
        minutes: d.getMinutes()
      };
    })(),
    snooze: false,
    once: true,
    id: 'alarm-' + Math.random(),
    name: ''
  }, restart = false) => {
    // Get current weekday (0-6)
    const currentDay = new Date().getDay();
    
    const dayCheckboxes = [...document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')];
    
    // If this is a new alarm (empty days array) and once is true
    if (o.days.length === 0 && o.once) {
      // Select only current day
      dayCheckboxes.forEach(checkbox => {
        checkbox.checked = Number(checkbox.value) === currentDay;
      });
    } else {
      // For existing alarms, set days as stored
      dayCheckboxes.forEach(e => {
        e.checked = o.days.indexOf(Number(e.value)) !== -1;
      });
    }
  
    hours.value = ('0' + o.time.hours).substr(-2);
    minutes.value = ('0' + o.time.minutes).substr(-2);
    document.querySelector('.alarm [data-id="edit"] [data-id="once"]').checked = o.once;
    document.querySelector('.alarm [data-id="edit"]').dataset.assign = o.id;
    document.querySelector('.alarm [data-id="edit"]').dataset.restart = restart;
    document.querySelector('.alarm [data-id="edit"] [data-id="name"]').value = o.name || '';
  
    document.body.dataset.alarm = 'edit';
  
    hours.dispatchEvent(new Event('change', {
      bubbles: true
    }));
  };

}

alarm.remove = target => {
  const entry = target.closest('.entry');
  if (entry) {
    // remove alarms;
    const input = entry.querySelector('input:checked');
    if (input) {
      input.click();
    }
    entry.remove();
    chrome.storage.local.get({
      alarms: []
    }, prefs => {
      chrome.storage.local.set({
        alarms: prefs.alarms.filter(a => a.id.startsWith(entry.dataset.id) === false)
      });
      showPlaceholderImage()
    });
  }
};

document.querySelector('.alarm div[data-id="content"]').addEventListener('click', ({target}) => {
  const entry = target.closest('.entry');
  if (entry && target.classList.contains('switch') === false) {
    const active = entry.querySelector('.switch').checked;
    alarm.edit(entry.o, active);
  }
});

// update toast on "alarms-storage" change
chrome.storage.onChanged.addListener(ps => {
  if (ps['alarms-storage']) {
    alarm.toast();
  }
});

// Modify the once checkbox handler to update days selection
document.querySelector('.alarm [data-id="edit"] [data-id="once"]').addEventListener('change', e => {
  const dayCheckboxes = document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]');
  
  if (e.target.checked) {
    // When "Once" is checked, only select current day
    const currentDay = new Date().getDay();
    dayCheckboxes.forEach(checkbox => {
      checkbox.checked = Number(checkbox.value) === currentDay;
    });
  } else {
    // When "Once" is unchecked, select all days
    dayCheckboxes.forEach(checkbox => {
      checkbox.checked = true;
    });
  }
});

// Also modify the helper function for consistent behavior
document.querySelector('.alarm [data-id="edit"] [data-id="once"]').onclick = e => {
  const days = [...document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]:checked')];
  if (e.target.checked) {
    // When checking "Once", clear all days except current
    const currentDay = new Date().getDay();
    for (const e of document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')) {
      e.checked = Number(e.value) === currentDay;
    }
  } else {
    // When unchecking "Once", select all days if none are selected
    if (days.length === 0 || days.length === 1) {  // Also check if only one day is selected
      for (const e of document.querySelectorAll('.alarm [data-id="edit"] [data-id="days"] input[type=checkbox]')) {
        e.checked = true;
      }
    }
  }
};

const minutes = document.querySelector('.alarm input[data-id="minutes"]');
const hours = document.querySelector('.alarm input[data-id="hours"]');

minutes.addEventListener('wheel', function(event) {
  event.preventDefault();

  if (event.deltaY < 0) {
    minutes.stepUp(); 
  } else if (event.deltaY > 0) {
    minutes.stepDown();
  }

  fix(event, 0, 59)

});

hours.addEventListener('wheel', function(event) {
  event.preventDefault();

  if (event.deltaY < 0) {
    hours.stepUp(); 
  } else if (event.deltaY > 0) {
    hours.stepDown();
  }

  fix(event, 0, 23)

});

const fix = (e, min = 0, max = 23) => {
  e.target.value = Math.max(min, Math.min(max, e.target.valueAsNumber)).toString().padStart(2, '0');
};

window.addEventListener('keydown', async ev => {
  if(ev.code === 'Enter' || ev.code === 'NumpadEnter' || ev.code === 'Space') {

    if (document.body.dataset.alarm === 'view') {
      alarm.edit();
    } else {
      alarm.save();
    }
  }
})
