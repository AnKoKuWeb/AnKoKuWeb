// Конфигурация ICE (STUN-серверы)
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Состояние приложения
const state = {
  peerConnection: null,
  dataChannel: null,
  localStream: null,
  remoteStream: null,
  role: null, // 'caller' или 'callee'
  iceCandidates: []
};

// Элементы UI
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
  audioElement: document.createElement('audio') // Для удаленного аудио
};

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  updateUI();
});

function initEventListeners() {
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
}

function setRole(role) {
  state.role = role;
  updateUI();
  updateStatus(`Роль: ${role === 'caller' ? 'Инициатор' : 'Получатель'}`, 'info');
}

// Генерация кода подключения
async function generateConnectionCode() {
  if (!state.role) {
    alert('Сначала выберите роль (Инициатор/Получатель)');
    return;
  }

  try {
    resetConnection();
    state.peerConnection = new RTCPeerConnection(ICE_CONFIG);

    // Собираем ICE-кандидаты
    state.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        state.iceCandidates.push(event.candidate.toJSON());
      }
    };

    // Для инициатора создаем DataChannel
    if (state.role === 'caller') {
      state.dataChannel = state.peerConnection.createDataChannel('chat');
      setupDataChannel(state.dataChannel);
    } else {
      // Для получателя ждем DataChannel от инициатора
      state.peerConnection.ondatachannel = (event) => {
        state.dataChannel = event.channel;
        setupDataChannel(state.dataChannel);
      };
    }

    // Генерируем SDP предложение/ответ
    if (state.role === 'caller') {
      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);
    } else {
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);
    }

    // Ждем завершения сбора ICE-кандидатов
    await waitForIceGatheringComplete();

    // Формируем код
    const connectionData = {
      sdp: state.peerConnection.localDescription.toJSON(),
      iceCandidates: state.iceCandidates,
      role: state.role
    };

    ui.localCode.value = btoa(JSON.stringify(connectionData));
    updateStatus('Код сгенерирован', 'success');
    ui.btnCopy.disabled = false;
  } catch (error) {
    console.error('Ошибка генерации кода:', error);
    updateStatus('Ошибка генерации', 'error');
  }
}

// Обработка кода от собеседника
async function processRemoteCode() {
  if (!ui.remoteCode.value) {
    alert('Вставьте код подключения от собеседника');
    return;
  }

  try {
    const remoteData = JSON.parse(atob(ui.remoteCode.value));
    
    if (!state.peerConnection) {
      state.peerConnection = new RTCPeerConnection(ICE_CONFIG);
      
      // Настройка DataChannel для получателя
      if (state.role === 'callee') {
        state.peerConnection.ondatachannel = (event) => {
          state.dataChannel = event.channel;
          setupDataChannel(state.dataChannel);
        };
      }
    }

    // Устанавливаем удаленное описание
    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(remoteData.sdp)
    );

    // Добавляем ICE-кандидаты
    for (const candidate of remoteData.iceCandidates) {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    // Если мы инициатор, создаем ответ
    if (state.role === 'caller' && remoteData.role === 'callee') {
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);
      await waitForIceGatheringComplete();

      const responseData = {
        sdp: state.peerConnection.localDescription.toJSON(),
        iceCandidates: state.iceCandidates,
        role: state.role
      };

      ui.localCode.value = btoa(JSON.stringify(responseData));
      updateStatus('Ответ сгенерирован', 'success');
    }

    updateStatus('Подключение установлено', 'success');
    ui.btnCall.disabled = false;
  } catch (error) {
    console.error('Ошибка обработки кода:', error);
    updateStatus('Ошибка подключения', 'error');
  }
}

// Настройка DataChannel
function setupDataChannel(channel) {
  channel.onopen = () => {
    updateStatus('Чат подключен', 'success');
    ui.messageInput.disabled = false;
    ui.btnSend.disabled = false;
  };

  channel.onclose = () => {
    updateStatus('Чат отключен', 'error');
    ui.messageInput.disabled = true;
    ui.btnSend.disabled = true;
  };

  channel.onmessage = (event) => {
    addMessageToChat(`Собеседник: ${event.data}`, 'remote');
  };
}

// Отправка сообщения
function sendMessage() {
  const message = ui.messageInput.value.trim();
  if (!message || !state.dataChannel) return;

  try {
    state.dataChannel.send(message);
    addMessageToChat(`Вы: ${message}`, 'local');
    ui.messageInput.value = '';
  } catch (error) {
    console.error('Ошибка отправки:', error);
  }
}

// Начало аудиозвонка
async function startAudioCall() {
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Добавляем аудио потоки
    state.localStream.getTracks().forEach(track => {
      state.peerConnection.addTrack(track, state.localStream);
    });

    // Обработка удаленного потока
    state.peerConnection.ontrack = (event) => {
      state.remoteStream = event.streams[0];
      ui.audioElement.srcObject = state.remoteStream;
      ui.audioElement.play().catch(e => console.error('Ошибка воспроизведения:', e));
    };

    updateStatus('Звонок начат', 'success');
    ui.btnHangup.disabled = false;
    ui.btnCall.disabled = true;
  } catch (error) {
    console.error('Ошибка звонка:', error);
    updateStatus('Ошибка доступа к микрофону', 'error');
  }
}

// Завершение звонка
function hangUpCall() {
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

  updateStatus('Звонок завершен', 'info');
  ui.btnHangup.disabled = true;
  ui.btnCall.disabled = false;
}

// Вспомогательные функции
function waitForIceGatheringComplete() {
  return new Promise((resolve) => {
    if (state.peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (state.peerConnection.iceGatheringState === 'complete') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    }
  });
}

function resetConnection() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  state.iceCandidates = [];
  state.dataChannel = null;
}

function addMessageToChat(message, type) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', type);
  messageElement.textContent = message;
  ui.messages.appendChild(messageElement);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function copyLocalCode() {
  ui.localCode.select();
  document.execCommand('copy');
  ui.btnCopy.textContent = 'Скопировано!';
  setTimeout(() => {
    ui.btnCopy.textContent = 'Копировать';
  }, 2000);
}

function updateStatus(text, status) {
  ui.statusText.textContent = text;
  ui.status.className = `status ${status}`;
}

function updateUI() {
  ui.btnCaller.disabled = state.role === 'caller';
  ui.btnCallee.disabled = state.role === 'callee';
  ui.btnGenerate.disabled = !state.role;
  ui.btnConnect.disabled = !state.role || !ui.remoteCode.value;
  ui.btnCopy.disabled = !ui.localCode.value;
  ui.messageInput.disabled = !state.dataChannel;
  ui.btnSend.disabled = !state.dataChannel;
}