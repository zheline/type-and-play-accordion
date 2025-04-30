let currentSystem = "C";

const cSystemLayout = [ 
  [48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90], // 第一排
  [47, 50, 53, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83, 86, 89, 92], // 第二排
  [49, 52, 55, 58, 61, 64, 67, 70, 73, 76, 79, 82, 85, 88, 91], // 第三排
  [51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90] // 第四排
];
const bSystemLayout = [
  [50, 53, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83, 86, 89, 92],
  [48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93],
  [49, 52, 55, 58, 61, 64, 67, 70, 73, 76, 79, 82, 85, 88, 91],
  [50, 53, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83, 86, 89],
];

const keyboardLayout = [
  ['Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']
];

let offset = 2;  // 每排從第3個音（index 2）開始對應
let fullLayout = cSystemLayout;

function getMappedNotes() {
  return keyboardLayout.map((row, rowIndex) => {
    const notes = fullLayout[rowIndex].slice(offset, offset + row.length);
    return row.map((key, i) => ({
      key,
      note: notes[i] ?? null // 如果超出範圍就填 null
    }));
  });
}

function midiToNote(midi) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pitchClass = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return noteNames[pitchClass] + octave;
}

let audioCtx;
let attackBuffer = null;
let loopBuffer = null;
let sources = {};
let noteCounts = {}; // 例：{ "A3": 2, "C5": 1 }
let noteElements = {}; // 例如：noteElements["C4"] = <div class="key white">C4</div>
let masterGain;
let activeTouches = {};

function createWhiteNoiseReverb(audioCtx, duration = 0.5, decay = 5) {
  const sampleRate = audioCtx.sampleRate;
  const length = sampleRate * duration;

  const impulse = audioCtx.createBuffer(2, length, sampleRate); // 雙聲道 IR
  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // 白噪音 + 指數衰減
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / duration, decay);
    }
  }

  const convolver = audioCtx.createConvolver();
  convolver.buffer = impulse;
  return convolver;
}

async function loadAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  const response = await fetch("./sounds/accordion-attacked-shot.mp3");
  const arrayAttackBuffer = await response.arrayBuffer();
  attackBuffer = await audioCtx.decodeAudioData(arrayAttackBuffer);
  
  const loopResponse = await fetch("./sounds/accordion-sustained-shot.mp3");
  const loopArrayBuffer = await loopResponse.arrayBuffer();
  loopBuffer = await audioCtx.decodeAudioData(loopArrayBuffer);
  
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.8;
  
  // Dry Path
  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.7;

  // Wet Path (Reverb Bus)
  const wetGain = audioCtx.createGain();
  wetGain.gain.value = 0.3;
  
  let decay = 5;
  let duration = parseFloat(document.getElementById("durationSlider").value);
  reverb = createWhiteNoiseReverb(audioCtx, duration, decay);
  // 白噪音 Reverb 輸出 → wetGain
  reverb.connect(wetGain);
  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  
  document.getElementById("volumeSlider").addEventListener("input", e => {
    const vol = parseFloat(e.target.value);
    masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);
  });
  
  // 控制 reverb duration 滑桿
  const durationSlider = document.getElementById("durationSlider");

  durationSlider.addEventListener("input", () => {
    duration = parseFloat(durationSlider.value);

    // 重新產生新的 IR 並替換
    const newReverb = createWhiteNoiseReverb(audioCtx, duration, decay);
    if (reverb) {
      reverb.disconnect();
    }
    reverb = newReverb;
    reverb.connect(wetGain);
  });  
  
  document.addEventListener("touchstart", () => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }, { once: true });

  
  document.getElementById("loading").style.display = "none";
  renderKeyboard();
}

function playNote(midi) {
  if (!attackBuffer || !loopBuffer) return;

  if (!noteCounts[midi]) {
    noteCounts[midi] = 0;
  }

  noteCounts[midi]++;
  
  if (noteElements[midi]) {
  	noteElements[midi].forEach(el => el.classList.add("active"));
	}

  if (sources[midi]) return; // 已在播放，不重播

  const attackSource = audioCtx.createBufferSource();
  const attackGain = audioCtx.createGain();
  attackSource.buffer = attackBuffer;
  
  const semitoneDiff = midi - 66;
  const playbackRate = Math.pow(2, semitoneDiff / 12);
  attackSource.playbackRate.value = playbackRate;
   // 加上 loop start / end
  attackSource.connect(attackGain);
  attackGain.connect(dryGain);
  attackGain.connect(reverb);
  attackSource.start(0);
  
  const loopSource = audioCtx.createBufferSource();
  const loopGain = audioCtx.createGain();
  loopSource.buffer = loopBuffer;
  loopSource.loop = true;
  loopSource.loopStart = 0; // 可視音檔內容調整
  loopSource.loopEnd = loopBuffer.duration;
  loopSource.playbackRate.value = playbackRate;
  loopSource.connect(loopGain);
  loopGain.connect(dryGain);
  loopGain.connect(reverb);

  // 播放時間：接在 attack 結束後一點點，避免接縫突兀
  const attackDuration = attackBuffer.duration / attackSource.playbackRate.value;
  loopSource.start(audioCtx.currentTime + attackDuration);

  // 一起記錄起來
  sources[midi] = [
  { source: attackSource, gain: attackGain },
  { source: loopSource, gain: loopGain }
];
}

function stopNote(midi) {
  if (!noteCounts[midi]) return;

  noteCounts[midi]--;
  
  console.log(`[STOP] 音符：${midi}，剩餘按壓計數：${noteCounts[midi]}`);

  if (noteCounts[midi] <= 0) {
    const src = sources[midi];
    if (src) {
    	console.log(`[STOP] 停止播放音符：${midi}`);
      src.forEach(({ source, gain }) => {
        if (gain && gain.gain) {
          // 緩慢淡出 0.1 秒
          gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
        }
        source.onended = () => {
          source.disconnect();
        };
        source.stop(audioCtx.currentTime + 0.05);
      });
      delete sources[midi];
    }
    delete noteCounts[midi];
    
    if (noteElements[midi]) {
  		noteElements[midi].forEach(el => el.classList.remove("active"));
		}  
  }
}

function renderKeyboard() {
	console.log("renderKeyboard 開始");
	noteElements = {};
  const app = document.getElementById("app");
  app.innerHTML = ""; // 清除舊的內容

  const mapped = getMappedNotes(); // 使用最新 mapping

  mapped.forEach((row, rowIndex) => { 
    const rowDiv = document.createElement("div");
    rowDiv.className = "row";

    row.forEach(({ key, note }) => {
      const keyDiv = document.createElement("div");
      keyDiv.className = "key " + (note !== null && midiToNote(note).includes("#") ? "black" : "white");
      keyDiv.textContent = note !== null ? midiToNote(note) : "--";

      if (note !== null) {
        if (!noteElements[note]) {
          noteElements[note] = [];
        }
        noteElements[note].push(keyDiv);
				
        let mouseisdown = false;
        keyDiv.onmousedown = () => {
        	mouseisdown = true;
          audioCtx.resume();
          playNote(note);
        };
        keyDiv.onmouseup = () => {
        	mouseisdown = false;
          stopNote(note);
        };
        keyDiv.onmouseleave = () => {
        	if (mouseisdown) {
          	mouseisdown = false;
          	stopNote(note);
          }
        };
        keyDiv.addEventListener("touchstart", (e) => {
          audioCtx.resume();
          e.preventDefault();
          [...e.changedTouches].forEach(touch => {
            const id = touch.identifier;
            activeTouches[id] = note; // 記住哪根手指按了哪個音
            playNote(note);
          });
        });

        keyDiv.addEventListener("touchend", (e) => {
          e.preventDefault();
          [...e.changedTouches].forEach(touch => {
            const id = touch.identifier;
            const noteToStop = activeTouches[id];
            if (noteToStop) {
              stopNote(noteToStop);
              delete activeTouches[id];
            }
          });
        });
        keyDiv.addEventListener("touchcancel", (e) => {
          e.preventDefault();
          [...e.changedTouches].forEach(touch => {
            const id = touch.identifier;
            const noteToStop = activeTouches[id];
            if (noteToStop) {
              stopNote(noteToStop);
              delete activeTouches[id];
            }
          });
        });
      }

      rowDiv.appendChild(keyDiv);
    });
    app.appendChild(rowDiv);
  });
  // ✅ 保險起見：滑鼠放開時全局清掉狀態
  document.onmouseup = () => {
    // 雖然 mouseIsDown 是區域變數，但你可用 Set 或全局控制多鍵（進階可加）
  };
}

let keyMap = {}; // 每次 offset 更新都要重建

function updateUI() {
	if (!keyboardLayout || !fullLayout) return;
  const mapped = getMappedNotes(offset);

  keyMap = {}; // 重建 keyMap
  mapped.forEach(row => {
    row.forEach(({ key, note }) => {
      if (note !== null) {
        keyMap[key] = note;
      }
    });
  });

  // 顯示目前對應表（純文字）
  const output = mapped.map((row) =>
    row.map(({ key, note }) =>
      note !== null ? `${key}:${note}` : `${key}:--`
    ).join("  ")
  ).join("\n");

  document.getElementById("output").textContent = "";
  
  renderKeyboard()
  
}

function updateSystemButtons() {
  document.querySelectorAll("#systemSelector button").forEach(btn => btn.classList.remove("active"));
  if (currentSystem === "C") {
    document.getElementById("cSystemBtn").classList.add("active");
  } else {
    document.getElementById("bSystemBtn").classList.add("active");
  }
}

function stopAllNotes() {
  for (const midi in sources) {
    stopNote(Number(midi));
  }
  pressedKeys.clear(); // 清空按鍵狀態
}

let pressedKeys = new Set();

window.addEventListener("keydown", (e) => {
  const midi = keyMap[e.code];
  if (midi && !pressedKeys.has(e.code)) {
  	console.log(`[KEYDOWN] 按下鍵：${e.code} → 音符：${midi}`);
    pressedKeys.add(e.code);
    audioCtx.resume();
    playNote(midi);
  }
});
window.addEventListener("keyup", (e) => {
  const midi = keyMap[e.code];
  if (midi && pressedKeys.has(e.code)) {
    pressedKeys.delete(e.code);
  	stopNote(midi);
  } else {
    console.log(`[KEYUP] 忽略釋放：${e.code}（未曾按下或 note 不存在）`);
  }
});

window.addEventListener('blur', () => {
  stopAllNotes();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopAllNotes();
  }
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === "INPUT") return;
  if (e.code === 'ArrowLeft') {
    offset = Math.max(0, offset - 1);
    stopAllNotes()
    updateUI();
  } else if (e.code === 'ArrowRight') {
    offset = Math.min(4, offset + 1);
    stopAllNotes()
    updateUI();
  }
});
function switchSystem(system) {
  currentSystem = system;
  fullLayout = system === "C" ? cSystemLayout : bSystemLayout;
  stopAllNotes();
  updateUI(); // ✅ 這裡才會更新 keyMap + renderKeyboard
  updateSystemButtons();
}

document.getElementById("cSystemBtn").onclick = () => switchSystem("C");
document.getElementById("bSystemBtn").onclick = () => switchSystem("B");


const inputs = document.querySelectorAll('input[type="range"]');

document.addEventListener("mouseup", () => {
  inputs.forEach(input => {
    if (document.activeElement === input) {
      input.blur();
    }
  });
});

document.addEventListener("touchend", () => {
  inputs.forEach(input => {
    if (document.activeElement === input) {
      input.blur();
    }
  });
});

loadAudio();
updateSystemButtons();
updateUI();
