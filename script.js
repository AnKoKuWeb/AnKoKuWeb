// Конфигурация ICE серверов (STUN/TURN)
const ICE_CONFIG = {
  iceServers: [
    // Google STUN серверы
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    
    // Резервный TURN сервер (бесплатный)
    {
      urls: 'turn:numb.viagenie.ca',
      credential: 'muazkh',
      username: 'webrtc@live.com'
    }
  ],
  iceTransportPolicy: 'all' // Использовать и STUN и TURN
};

// Состояние приложения
const state = {
  peerConnection: null,
  dataChannel: null,
  localStream: null,
  remoteStream: null,
  role: null, // 'caller' или 'callee'
  iceCandidates: [],
  isProcessing: false,
  isCallActive: false
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
  audioElement: new Audio() // Для удаленного аудио
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', init);

function init() {
  setupEventListeners();
  checkWebRTCSupport();
  updateUI();
}

// Проверка поддержки WebRTC
function checkWebRTCSupport() {
  if (!window.RTCPeerConnection || !window.navigator.mediaDevices?.getUserMedia) {
    showFatalError("Ваш браузер не поддерживает WebRTC. Пожалуйста, используйте Chrome, Firefox или Edge.");
    return false;
  }
  return true;
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

  ui.remoteCode.addEventListener('input', updateUI);
}

// Установка роли (Caller/Callee)
function setRole(role) {
  if (state.role === role) return;
  
  resetConnection();
  state.role = role;
  updateStatus(`Роль: ${role === 'caller' ? 'Инициатор' : 'Получатель'}`, 'info');
  updateUI();
}

// Генерация кода подключения
async function generateConnectionCode() {
  if (state.isProcessing) return;
  state.isProcessing = true;
  
  try {
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
        console.log("ICE кандидат:", event.candidate);
      }
    };

    // Обработка изменения состояния ICE
    state.peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE состояние:", state.peerConnection.iceConnectionState);
      if (state.peerConnection.iceConnectionState === 'failed') {
        console.error("ICE соединение не удалось");
      }
    };

    // Для инициатора создаем DataChannel
    if (state.role === 'caller') {
      state.dataChannel = state.peerConnection.createDataChannel('chat', {
        negotiated: true,
        id: 0,
        ordered: true
      });
      setupDataChannel(state.dataChannel);
    } else {
      // Для получателя ждем DataChannel
      state.peerConnection.ondatachannel = (event) => {
        state.dataChannel = event.channel;
        setupDataChannel(state.dataChannel);
      };
    }

    // Генерация SDP предложения/ответа
    let sdp;
    if (state.role === 'caller') {
      sdp = await state.peerConnection.createOffer({
        offerToReceiveAudio: true
      });
      console.log("SDP предложение:", sdp);
    } else {
      if (!ui.remoteCode.value.trim()) {
        throw new Error("Сначала введите код собеседника");
      }
      
      // Для получателя сначала обрабатываем код
      await processRemoteCode(true);
      sdp = await state.peerConnection.createAnswer();
      console.log("SDP ответ:", sdp);
    }

    await state.peerConnection.setLocalDescription(sdp);
    console.log("Local description установлен:", state.peerConnection.localDescription);

    // Ждем ICE кандидатов (таймаут 5 секунд)
    await waitForIceCandidates(5000);

    // Формируем код подключения
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
    console.error("Ошибка генерации кода:", error);
    updateStatus(`Ошибка: ${error.message}`, "error");
    resetConnection();
  } finally {
    state.isProcessing = false;
    updateUI();
  }
}

// Ожидание ICE кандидатов
function waitForIceCandidates(timeout = 3000) {
  return new Promise((resolve) => {
    if (state.peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      console.warn("Таймаут ожидания ICE кандидатов");
      resolve();
    }, timeout);

    state.peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        clearTimeout(timer);
        resolve();
      }
    };
  });
}

// Обработка кода от собеседника
async function processRemoteCode(silent = false) {
  try {
    const remoteCode = ui.remoteCode.value.trim();
    if (!remoteCode) {
      throw new Error("Введите код подключения");
    }

    const remoteData = JSON.parse(decodeURIComponent(atob(remoteCode)));
    console.log("Полученные данные:", remoteData);

    if (!state.peerConnection) {
      state.peerConnection = new RTCPeerConnection(ICE_CONFIG);
      state.iceCandidates = [];
    }

    // Устанавливаем удаленное описание
    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(remoteData.sdp)
    );

    // Добавляем ICE кандидаты
    if (remoteData.ice && remoteData.ice.length > 0) {
      for (const candidate of remoteData.ice) {
        try {
          await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (iceError) {
          console.warn("Ошибка добавления ICE кандидата:", iceError);
        }
      }
    }

    if (!silent) {
      updateStatus("Успешное подключение!", "success");
      ui.btnCall.disabled = false;
    }

    return true;

  } catch (error) {
    console.error("Ошибка обработки кода:", error);
    if (!silent) {
      updateStatus(`Ошибка: ${error.message}`, "error");
    }
    return false;
  }
}

// Настройка DataChannel
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log("DataChannel открыт");
    updateStatus("Чат подключен", "success");
    updateUI();
  };

  channel.onclose = () => {
    console.log("DataChannel закрыт");
    updateStatus("Чат отключен", "error");
    updateUI();
  };

  channel.onerror = (error) => {
    console.error("DataChannel ошибка:", error);
    updateStatus("Ошибка соединения чата", "error");
  };

  channel.onmessage = (event) => {
    addMessageToChat(`Собеседник: ${event.data}`, "remote");
  };
}

// Отправка сообщения
function sendMessage() {
  const message = ui.messageInput.value.trim();
  if (!message || !state.dataChannel || state.dataChannel.readyState !== 'open') return;

  try {
    state.dataChannel.send(message);
    addMessageToChat(`Вы: ${message}`, "local");
    ui.messageInput.value = '';
  } catch (error) {
    console.error("Ошибка отправки сообщения:", error);
    updateStatus("Ошибка отправки", "error");
  }
}

// Начало аудиозвонка
async function startAudioCall() {
  try {
    updateStatus("Запрос микрофона...", "warning");
    
    // Получаем доступ к микрофону
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
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
        ui.audioElement.play().catch(e => console.error("Ошибка воспроизведения:", e));
        updateStatus("Звонок активен", "success");
        state.isCallActive = true;
      }
    };

    ui.btnCall.disabled = true;
    ui.btnHangup.disabled = false;

  } catch (error) {
    console.error("Ошибка начала звонка:", error);
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
    // Останавливаем локальные треки
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }

    // Останавливаем удаленные треки
    if (state.remoteStream) {
      state.remoteStream.getTracks().forEach(track => track.stop());
      state.remoteStream = null;
    }

    // Останавливаем аудио элемент
    if (ui.audioElement.srcObject) {
      ui.audioElement.pause();
      ui.audioElement.srcObject = null;
    }

    updateStatus("Звонок завершен", "info");
    state.isCallActive = false;
    ui.btnCall.disabled = false;
    ui.btnHangup.disabled = true;

  } catch (error) {
    console.error("Ошибка завершения звонка:", error);
  }
}

// Сброс соединения
function resetConnection() {
  try {
    // Закрываем соединение
    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }
    
    // Закрываем DataChannel
    if (state.dataChannel) {
      state.dataChannel.close();
      state.dataChannel = null;
    }

    // Очищаем состояние
    state.iceCandidates = [];
    state.isCallActive = false;

    // Сбрасываем UI
    ui.localCode.value = '';
    ui.btnCopy.disabled = true;
    ui.btnCall.disabled = true;
    ui.btnHangup.disabled = true;
    ui.messageInput.disabled = true;
    ui.btnSend.disabled = true;

  } catch (error) {
    console.error("Ошибка сброса соединения:", error);
  }
}

// Добавление сообщения в чат
function addMessageToChat(message, type) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${type}`;
  messageElement.textContent = message;
  ui.messages.appendChild(messageElement);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

// Копирование локального кода
function copyLocalCode() {
  try {
    ui.localCode.select();
    document.execCommand('copy');
    ui.btnCopy.textContent = '✓ Скопировано';
    setTimeout(() => {
      ui.btnCopy.textContent = 'Копировать';
    }, 2000);
  } catch (error) {
    console.error("Ошибка копирования:", error);
    updateStatus("Не удалось скопировать", "error");
  }
}

// Обновление статуса
function updateStatus(text, status) {
  ui.statusText.textContent = text;
  ui.status.className = `status ${status}`;
}

// Обновление интерфейса
function updateUI() {
  ui.btnCaller.disabled = state.role === 'caller';
  ui.btnCallee.disabled = state.role === 'callee';
  ui.btnGenerate.disabled = !state.role || state.isProcessing;
  ui.btnConnect.disabled = !state.role || !ui.remoteCode.value.trim();
  ui.btnCopy.disabled = !ui.localCode.value;
  
  // Состояние чата
  const isChatActive = state.dataChannel && state.dataChannel.readyState === 'open';
  ui.messageInput.disabled = !isChatActive;
  ui.btnSend.disabled = !isChatActive;
  
  // Состояние звонка
  ui.btnCall.disabled = !state.peerConnection || state.isCallActive;
  ui.btnHangup.disabled = !state.isCallActive;
}

// Показать фатальную ошибку
function showFatalError(message) {
  alert(message);
  document.body.innerHTML = `
    <div style="padding:20px;color:red;font-size:18px;">
      <h1>Ошибка</h1>
      <p>${message}</p>
      <p>Пожалуйста, используйте современный браузер (Chrome, Firefox, Edge)</p>
    </div>
  `;
}

// Диагностика соединения (для консоли)
window.debugConnection = function() {
  console.log('--- Диагностика соединения ---');
  console.log('Состояние PeerConnection:', state.peerConnection ? {
    iceConnectionState: state.peerConnection.iceConnectionState,
    connectionState: state.peerConnection.connectionState,
    signalingState: state.peerConnection.signalingState,
    iceGatheringState: state.peerConnection.iceGatheringState
  } : 'Не создано');
  
  console.log('DataChannel:', state.dataChannel ? {
    readyState: state.dataChannel.readyState,
    bufferedAmount: state.dataChannel.bufferedAmount
  } : 'Не создан');
  
  console.log('ICE кандидаты:', state.iceCandidates.length);
  console.log('Локальный поток:', state.localStream);
  console.log('Удаленный поток:', state.remoteStream);
};