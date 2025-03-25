import Analytics from '../../google-analytics.js';

const args = new URLSearchParams(location.search);

chrome.runtime.sendMessage({
  method: 'position',
  screen: {
    width: screen.width,
    height: screen.height
  },
  window: {
    width: window.outerWidth,
    height: window.outerHeight
  },
  position: args.get('position')
}, () => chrome.runtime.lastError);

Analytics.fireEvent('showNotification')

document.getElementById('snooze').onclick = () => {
  const buttonIndex = document.getElementById('range').selectedIndex + 1;

  chrome.runtime.sendMessage({
    method: 'set-alarm',
    name: 'audio-' + args.get('name') + '/' + buttonIndex,
    info: {
      when: Date.now() + buttonIndex * 5 * 60 * 1000
    }
  }, () => setTimeout(() => window.close(), 100));
};

document.getElementById('done').onclick = () => window.close();

// audio
const audio = {};
audio.cache = {};
audio.play = (id, src, n = 5, volume = 1.0) => {
  audio.stop(id);
  const e = new Audio();
  e.volume = volume;
  e.addEventListener('ended', function() {
    n -= 1;
    if (n > 0) {
      e.currentTime = 0;
      e.play();
    }
    else {
      delete audio.cache[id];
    }
  }, false);
  audio.cache[id] = e;
  e.src = '/' + src;
  e.play();
};
audio.stop = id => {
  const e = audio.cache[id];
  if (e) {
    e.pause();
    e.currentTime = 0;
    delete audio.cache[id];
  }
};
audio.play(args.get('name'), args.get('sound'), Number(args.get('repeats'), Number(args.get('volume'))));

// bring to front
window.onblur = () => setTimeout(() => chrome.runtime.sendMessage({
  method: 'bring-to-front'
}, () => chrome.runtime.lastError), 100);

// messaging
chrome.runtime.onMessage.addListener((request, sender, resposne) => {
  if (request.method === 'remove-notification') {
    if (request.name === args.get('name')) {
      resposne(true);
      window.close();
    }
  }
  else if (request.method === 'remove-all-notifications') {
    window.close();
  }
});

// persist
document.getElementById('range').onchange = e => chrome.storage.local.set({
  'range-index': e.target.selectedIndex
});
chrome.storage.local.get({
  'range-index': 0
}, prefs => document.getElementById('range').selectedIndex = prefs['range-index']);


const alarmName = args.get('alarmName') || '';

document.addEventListener('DOMContentLoaded', () => {
  const notificationTitle = document.getElementById('notification-title');
  if (notificationTitle && alarmName) {
    notificationTitle.textContent = alarmName;
    document.body.classList.add('has-title');
  }
});