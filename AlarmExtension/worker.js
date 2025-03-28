'use strict';

import Analytics from "./google-analytics.js";

const notifications = {
  clear(name, c) {
    chrome.runtime.sendMessage({
      method: 'remove-notification',
      name
    }, () => {
      chrome.runtime.lastError;
      c();
    });
  },
  create(name, opts) {
    const args = new URLSearchParams();
    args.set('name', name);
    args.set('title', opts.title);
    args.set('message', opts.message);
    args.set('sound', opts.sound);
    args.set('volume', opts.volume);
    args.set('repeats', opts.repeats);
    // Add the alarm name to the URL parameters
    args.set('alarmName', opts.alarmName || '');

    chrome.storage.local.get({
      'notify-position': 'center' // center, br, tr
    }, prefs => {
      args.set('position', prefs['notify-position']);

      const p = {
        width: 350,
        height: 300,
        type: 'popup',
        url: 'data/notify/index.html?' + args.toString()
      };
      chrome.windows.create(p);
    });
  },
  kill() {
    chrome.runtime.sendMessage({
      method: 'remove-all-notifications'
    }, () => chrome.runtime.lastError);
  }
};

const alarms = {

  fire({name}) {
    const set = (name, title, sound, repeats, volume, message = `Time's up`) => {
      // Retrieve alarms to get the name
      chrome.storage.local.get({
        'alarms': []
      }, prefs => {
        // Find the alarm that matches the current alarm name
        const id = name.split(':')[0]; // Extract the base ID
        const alarm = prefs.alarms.find(a => a.id === id);
        
        notifications.clear(name, () => {
          notifications.create(name, {
            title,
            message: message + '\n\n' + (new Date()).toLocaleString(),
            sound,
            volume,
            repeats,
            alarmName: alarm ? alarm.name : '' // Use the name from the alarm object if found
          });
        });
      });
    };
    
    // Rest of the function remains the same as in the previous implementation
    if (name.startsWith('timer-')) {
      chrome.storage.local.get({
        'src-timer': 'data/sounds/1.mp3',
        'repeats-timer': 10,
        'volume-timer': 1.0
      }, prefs => {
        set(name, 'Timer', prefs['src-timer'], prefs['repeats-timer'], prefs['volume-timer']);
      });
    }
    else if (name.startsWith('alarm-')) {
      const id = name.split(':')[0];
      chrome.storage.local.get({
        'alarms': [],
        'src-alarm': 'data/sounds/1.mp3',
        'repeats-alarm': 5,
        'volume-alarm': 1.0
      }, prefs => {
        const o = prefs.alarms.filter(a => a.id === id).shift();
        if (o.snooze) {
          alarms.create('audio-' + id + '/1', {
            when: Date.now() + 5 * 60 * 1000
          });
          alarms.create('audio-' + id + '/2', {
            when: Date.now() + 10 * 60 * 1000
          });
        }
        set(id, 'Alarm', prefs['src-alarm'], prefs['repeats-alarm'], prefs['volume-alarm'], o.name);
      });
    }
    else if (name.startsWith('audio-')) {
      const id = name.replace('audio-', '').split('/')[0];
      chrome.storage.local.get({
        'alarms': [],
        'src-misc': 'data/sounds/1.mp3',
        'repeats-misc': 10,
        'volume-misc': 1.0
      }, prefs => {
        let title = 'Misc';
        if (id.startsWith('alarm-')) {
          title = 'Alarm';
        }
        else if (id.startsWith('timer-')) {
          title = 'Timer';
        }
        const o = prefs.alarms.filter(a => a.id === id).shift();
        set(id, title, prefs['src-misc'], prefs['repeats-misc'], prefs['volume-misc'], o?.name);
      });
    }
  },

  get(name, c) {
    chrome.alarms.get(name, c);
  },
  getAll(c) {
    chrome.alarms.getAll(c);
  }
};

// create or clear
{
  const cache = {
    create: new Map(),
    clear: new Set()
  };
  const step = () => {
    clearTimeout(step.id);
    step.id = setTimeout(() => {
      alarms.getAll(as => {
        chrome.storage.local.get({
          'alarms-storage': {}
        }, prefs => {
          // clear old alarms
          const keys = [
            ...cache.clear.keys(),
            ...cache.create.keys()
          ].map(s => s.split(':')[0]);

          for (const a of as.filter(a => keys.some(key => a.name.includes(key)))) {
            cache.clear.add(a.name);
          }

          // clear alarms
          for (const name of cache.clear) {
            if (cache.create.has(name) === false) {
              chrome.alarms.clear(name);
              delete prefs['alarms-storage'][name];
            }
          }
          cache.clear.clear();
          // set new alarms
          for (const [name, info] of cache.create) {
            chrome.alarms.create(name, info);
            prefs['alarms-storage'][name] = info;
          }
          cache.create.clear();
          chrome.storage.local.set(prefs);
        });
      });
    }, 100);
  };

  alarms.create = (name, info) => {
    cache.create.set(name, info);
    cache.clear.delete(name);
    step();
  };
  alarms.clear = (name, callback = () => {}) => {
    cache.clear.add(name);
    cache.create.delete(name);
    callback();
    step();
  };

  alarms.fire = new Proxy(alarms.fire, {
    apply(target, self, args) {
      const o = args[0];
      if (!o.periodInMinutes) {
        chrome.storage.local.get({
          'alarms-storage': {}
        }, prefs => {
          delete prefs['alarms-storage'][o.name];
          chrome.storage.local.set(prefs);
        });
      }

      return Reflect.apply(target, self, args);
    }
  });
}
{
  const once = () => chrome.storage.local.get({
    'alarms-storage': {}
  }, async prefs => {
    const now = Date.now();
    let modified = false;
    for (const [name, info] of Object.entries(prefs['alarms-storage'])) {
      if (info.when && info.when < now) {
        if (info.periodInMinutes) {
          while (info.when < now) {
            info.when += info.periodInMinutes * 60 * 1000;
          }
        }
        else {
          delete prefs['alarms-storage'][name];
        }
        modified = true;
      }
      if (name in prefs['alarms-storage']) {
        const o = await chrome.alarms.get(name);
        if (!o) {
          chrome.alarms.create(name, info);
          console.info('Force Creating a new Alarm', name, info);
        }
      }
    }
    if (modified) {
      chrome.storage.local.set(prefs);
    }
  });
  chrome.runtime.onStartup.addListener(once);
  chrome.runtime.onInstalled.addListener(once);
}

chrome.alarms.onAlarm.addListener(a => {
  alarms.fire(a);
});

/* handling outdated alarms */
chrome.idle.onStateChanged.addListener(state => {
  if (state === 'active') {
    const now = Date.now();
    chrome.alarms.getAll().then(os => {
      for (const o of os) {
        if (o.scheduledTime < now) {
          alarms.create(o.name, {
            when: now + 1000,
            periodInMinutes: o.periodInMinutes
          });
        }
      }
    });
  }
});

const onMessage = (request, sender, respose) => {
  if (request.method === 'set-alarm') {
    alarms.create(request.name, request.info);
  }
  else if (request.method === 'get-alarm') {
    alarms.get(request.name, respose);
    return true;
  }
  else if (request.method === 'get-alarms') {
    alarms.getAll(respose);
    return true;
  }
  else if (request.method === 'clear-alarm') {
    alarms.clear(request.name);
  }
  else if (request.method === 'batch') {
    for (const job of request.jobs) {
      if (job.method === 'clear-alarm') {
        alarms.clear(job.name);
      }
      else if (job.method === 'set-alarm') {
        alarms.create(job.name, job.info);
      }
    }
  }
  else if (request.method === 'remove-all-notifications') {
    notifications.kill();
  }
  else if (request.method === 'bring-to-front') {
    chrome.storage.local.get({
      'notify-on-top': false
    }, prefs => {
      if (prefs['notify-on-top']) {
        chrome.tabs.update(sender.tab.id, {
          highlighted: true
        });
        chrome.windows.update(sender.tab.windowId, {
          focused: true
        });
      }
    });
  }
  else if (request.method === 'position') {
    if (request.position === 'center') {
      chrome.windows.update(sender.tab.windowId, {
        left: parseInt((request.screen.width - request.window.width) / 2),
        top: parseInt((request.screen.height - request.window.height) / 2)
      });
    }
    else if (request.position === 'br') {
      chrome.windows.update(sender.tab.windowId, {
        left: parseInt(request.screen.width - request.window.width),
        top: parseInt(request.screen.height - request.window.height)
      });
    }
    else if (request.position === 'tr') {
      chrome.windows.update(sender.tab.windowId, {
        left: parseInt(request.screen.width - request.window.width),
        top: 0
      });
    }
  }
};
chrome.runtime.onMessage.addListener(onMessage);


chrome.storage.onChanged.addListener(ps => {
  if (ps.mode) {
    chrome.action.setPopup({
      popup: ps.mode.newValue === 'pp' ? '' : 'data/popup/index.html'
    });
  }
});
{
  const once = () => chrome.storage.local.get({
    mode: 'bp'
  }, prefs => chrome.action.setPopup({
    popup: prefs.mode === 'pp' ? '' : 'data/popup/index.html'
  }));
  chrome.runtime.onInstalled.addListener(once);
  chrome.runtime.onStartup.addListener(once);
}


{
  chrome.runtime.onInstalled.addListener(async (details) => {
    
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      
      Analytics.fireEvent('install');
      
      chrome.tabs.create({
        url: "https://darkwind666.github.io/AlarmExtensionSite/",
      });
    } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
      // When the extension is updated
    } else if (details.reason === chrome.runtime.OnInstalledReason.CHROME_UPDATE) {
      // When the browser is updated
    } else if (details.reason === chrome.runtime.OnInstalledReason.SHARED_MODULE_UPDATE) {
      // When a shared module is updated
    }
  
    const UNINSTALL_URL = "https://docs.google.com/forms/d/e/1FAIpQLScVKjhp2x3d7fTfPm9t-9Yy3qwWG_kehxz4ibwh9hvxmKC-vg/viewform?usp=sharing";
    chrome.runtime.setUninstallURL(UNINSTALL_URL);
  
  });
}
