// Конфигурация ICE серверов (STUN)
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' } // Дополнительный сервер
  ]
};

// Состояние приложения
const state = {
  peerConnection: null,
  dataChannel: null,
  localStream: null,
  remoteStream: null,
  role: null,
  iceCandidates: [],
  isGenerating: false
};

// Элементы интерфейса
const ui = {
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  localCode: document.getElementById('localCode'),
  remoteCode: document.getElementById('remoteCode'),
  messages: document.getElementById('messages'),
  messageInput: document.getElementById('messageInput'),
  btnGenerate: document.getElementById('btnGenerate'),
  btnCopy: document.getElementById('btnCopy'),
  btnConnect: document.getElementById('btnConnect'),
  btnSend: document.getElementById('btnSend'),
  btnCall: document.getElementById('btnCall'),
  btnHangup: document.getElementById('btnHangup'),
  btnCaller: document.getElementById('btnCaller'),
  btnCallee: document.getElementById('btnCallee'),
  audioElement: new Audio()
};

// Инициализация приложения
function init() {
  checkWebRTCSupport();
  setupEventListeners();
  updateUI();
}

// Проверка поддержки WebRTC
function checkWebRTCSupport() {
  if (!window.RTCPeerConnection || !window.navigator.mediaDevices?.getUserMedia) {
    showFatalError("Ваш браузер не поддерживает необходимые технологии WebRTC");
    throw new Error("WebRTC not supported");
  }
}

// Настройка обработчиков событий
function setupEventListeners() {
  ui.btnCaller.addEventListener('click', () => setRole('caller'));
  ui.btnCallee.addEventListener('click', () => setRole('callee'));
  ui.btnGenerate.addEventListener('click', generateConnectionCode);
  ui.btnCopy.addEventListener('click', copyLocalCode);
  ui.btnConnect.addEventListener('click', processRemoteCode);
  ui.btnSend.addEventListener('click', sendMessage);
  ui.btnCall.addEventListener('click', startAudioCall);
  ui.btnHangup.addEventListener('click', hangUpCall);
  
  ui.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  ui.remoteCode.addEventListener('input', () => {
    updateUI();
  });
}

// Установка роли (Caller/Callee)
function setRole(role) {
  if (state.role === role) return;
  
  resetConnection();
  state.role = role;
  updateUI();
  updateStatus(`Роль: ${role === 'caller' ? 'Инициатор' : 'Получатель'}`, 'info');
}

// Генерация кода подключения
async function generateConnectionCode() {
  if (state.isGenerating) return;
  state.isGenerating = true;
  
  try {
    // Валидация
    if (!state.role) {
      throw new Error("Сначала выберите роль");
    }

    resetConnection();
    updateStatus("Генерация кода...", "warning");
    ui.btnGenerate.disabled = true;

    // Создаем новое соединение
    state.peerConnection = new RTCPeerConnection(ICE_CONFIG);
    state.iceCandidates = [];

    // Настройка обработчиков ICE
    state.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        state.iceCandidates.push(event.candidate.toJSON());
        console.log("ICE candidate:", event.candidate);
      }
    };

    // Для инициатора создаем DataChannel
    if (state.role === 'caller') {
      state.dataChannel = state.peerConnection.createDataChannel('chat', {
        negotiated: true,
        id: 0
      });
      setupDataChannel(state.dataChannel);
    } else {
      // Для получателя ждем DataChannel
      state.peerConnection.ondatachannel = (event) => {
        state.dataChannel = event.channel;
        setupDataChannel(state.dataChannel);
      };
    }

    // Генерация SDP
    let sdp;
    if (state.role === 'caller') {
      sdp = await state.peerConnection.createOffer({
        offerToReceiveAudio: true
      });
    } else {
      if (!ui.remoteCode.value.trim()) {
        throw new Error("Сначала введите код собеседника");
      }
      
      // Для получателя сначала нужно установить удаленное описание
      await processRemoteCode(true);
      sdp = await state.peerConnection.createAnswer();
    }

    await state.peerConnection.setLocalDescription(sdp);
    console.log("Local description set:", state.peerConnection.localDescription);

    // Ждем завершения сбора ICE-кандидатов (таймаут 5 сек)
    await waitForIceGatheringComplete();

    // Формируем код
    const connectionData = {
      sdp: state.peerConnection.localDescription,
      ice: state.iceCandidates,
      role: state.role,
      timestamp: Date.now()
    };

    const codeString = JSON.stringify(connectionData);
    ui.localCode.value = btoa(unescape(encodeURIComponent(codeString)));
    updateStatus("Код сгенерирован!", "success");
    ui.btnCopy.disabled = false;

  } catch (error) {
    console.error("Generate code error:", error);
    updateStatus(`Ошибка: ${error.message}`, "error");
    resetConnection();
  } finally {
    state.isGenerating = false;
    updateUI();
  }
}

// Обработка кода от собеседника
async function processRemoteCode(silent = false) {
  try {
    const remoteCode = ui.remoteCode.value.trim();
    if (!remoteCode) {
      throw new Error("Введите код подключения");
    }

    const remoteData = JSON.parse(decodeURIComponent(atob(remoteCode)));
    console.log("Remote connection data:", remoteData);

    if (!state.peerConnection) {
      state.peerConnection = new RTCPeerConnection(ICE_CONFIG);
      state.iceCandidates = [];
    }

    // Устанавливаем удаленное описание
    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(remoteData.sdp)
    );

    // Добавляем ICE-кандидаты
    if (remoteData.ice && remoteData.ice.length > 0) {
      for (const candidate of remoteData.ice) {
        try {
          await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (iceError) {
          console.warn("Failed to add ICE candidate:", iceError);
        }
      }
    }

    if (!silent) {
      updateStatus("Код принят!", "success");
      ui.btnCall.disabled = false;
    }

    return true;

  } catch (error) {
    console.error("Process remote code error:", error);
    if (!silent) {
      updateStatus(`Ошибка: ${error.message}`, "error");
    }
    return false;
  }
}

// Настройка DataChannel
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log("DataChannel opened");
    updateStatus("Чат подключен", "success");
    updateUI();
  };

  channel.onclose = () => {
    console.log("DataChannel closed");
    updateStatus("Чат отключен", "error");
    updateUI();
  };

  channel.onerror = (error) => {
    console.error("DataChannel error:", error);
    updateStatus("Ошибка соединения чата", "error");
  };

  channel.onmessage = (event) => {
    addMessageToChat(`Собеседник: ${event.data}`, "remote");
  };
}

// Отправка сообщения
function sendMessage() {
  const message = ui.messageInput.value.trim();
  if (!message || !state.dataChannel) return;

  try {
    if (state.dataChannel.readyState !== 'open') {
      throw new Error("Соединение чата не активно");
    }

    state.dataChannel.send(message);
    addMessageToChat(`Вы: ${message}`, "local");
    ui.messageInput.value = '';
  } catch (error) {
    console.error("Send message error:", error);
    updateStatus(`Ошибка отправки: ${error.message}`, "error");
  }
}

// Начало аудиозвонка
async function startAudioCall() {
  try {
    updateStatus("Запрос микрофона...", "warning");
    
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    // Добавляем аудио треки
    state.localStream.getTracks().forEach(track => {
      state.peerConnection.addTrack(track, state.localStream);
    });

    // Обработка удаленного потока
    state.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        state.remoteStream = event.streams[0];
        ui.audioElement.srcObject = state.remoteStream;
        ui.audioElement.play().catch(e => console.error("Audio play error:", e));
        updateStatus("Звонок начат!", "success");
      }
    };

    ui.btnCall.disabled = true;
    ui.btnHangup.disabled = false;

  } catch (error) {
    console.error("Start call error:", error);
    updateStatus(`Ошибка: ${error.message}`, "error");
    
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }
  }
}

// Завершение звонка
function hangUpCall() {
  try {
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }

    if (state.remoteStream) {
      state.remoteStream.getTracks().forEach(track => track.stop());
      state.remoteStream = null;
    }

    if (ui.audioElement.srcObject) {
      ui.audioElement.pause();
      ui.audioElement.srcObject = null;
    }

    updateStatus("Звонок завершен", "info");
    ui.btnCall.disabled = false;
    ui.btnHangup.disabled = true;

  } catch (error) {
    console.error("Hang up error:", error);
  }
}

// Вспомогательные функции
function waitForIceGatheringComplete() {
  return new Promise((resolve) => {
    if (!state.peerConnection) return resolve();

    if (state.peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (state.peerConnection.iceGatheringState === 'complete') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    }
  });
}

function resetConnection() {
  try {
    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }
    
    if (state.dataChannel) {
      state.dataChannel.close();
      state.dataChannel = null;
    }

    state.iceCandidates = [];
    ui.localCode.value = '';
    ui.btnCopy.disabled = true;
    ui.btnCall.disabled = true;
    ui.btnHangup.disabled = true;
    ui.messageInput.disabled = true;
    ui.btnSend.disabled = true;

  } catch (error) {
    console.error("Reset connection error:", error);
  }
}

function addMessageToChat(message, type) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${type}`;
  messageElement.textContent = message;
  ui.messages.appendChild(messageElement);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function copyLocalCode() {
  try {
    ui.localCode.select();
    document.execCommand('copy');
    ui.btnCopy.textContent = '✓ Скопировано';
    setTimeout(() => {
      ui.btnCopy.textContent = 'Копировать';
    }, 2000);
  } catch (error) {
    console.error("Copy error:", error);
    updateStatus("Не удалось скопировать", "error");
  }
}

function updateStatus(text, status) {
  ui.statusText.textContent = text;
  ui.status.className = `status ${status}`;
}

function updateUI() {
  ui.btnCaller.disabled = state.role === 'caller';
  ui.btnCallee.disabled = state.role === 'callee';
  ui.btnGenerate.disabled = !state.role || state.isGenerating;
  ui.btnConnect.disabled = !state.role || !ui.remoteCode.value.trim();
  ui.messageInput.disabled = !state.dataChannel || state.dataChannel.readyState !== 'open';
  ui.btnSend.disabled = ui.messageInput.disabled;
}

function showFatalError(message) {
  alert(message);
  document.body.innerHTML = `<div class="error">${message}</div>`;
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', init);