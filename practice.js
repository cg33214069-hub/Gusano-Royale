const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Ajustar tamaño del canvas
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Configuración general de la sala de práctica
const MAP_SIZE = 2400;
const BOT_NAMES = [
  'Carlos_24', 'ElFlaco_VE', 'SofiG', 'KingApure', 'Luisito09',
  'MariaJose', 'Jhonny_R', 'Valeria22', 'AndresPRO', 'Kike_10', 'Nathy_M', 'Santi_G'
];
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

let gameState = 'PREP'; // 'PREP' (10s) -> 'COMBAT' (60s) -> 'ENDED'
let timeLeft = 10;
let worms = [];
let foods = [];
let mouse = { x: canvas.width / 2, y: canvas.height / 2, boosting: false };

// Eventos de control del jugador (Mouse y Touch)
window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
window.addEventListener('mousedown', () => mouse.boosting = true);
window.addEventListener('mouseup', () => mouse.boosting = false);
window.addEventListener('touchmove', (e) => {
  mouse.x = e.touches[0].clientX;
  mouse.y = e.touches[0].clientY;
});
window.addEventListener('touchstart', () => mouse.boosting = true);
window.addEventListener('touchend', () => mouse.boosting = false);

// Clase Gusano (sirve tanto para el Jugador como para los Bots)
class Worm {
  constructor(id, name, isPlayer, x, y, color) {
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.color = color;
    this.angle = Math.random() * Math.PI * 2;
    this.baseSpeed = 3.2;
    this.radius = 12;
    this.segments = [];
    this.targetLength = 25;
    this.simMoney = 0; // Bolívares simulados
    this.kills = 0;
    this.alive = true;
    this.aiTimer = 0;
    this.targetAngle = this.angle;

    for (let i = 0; i < this.targetLength; i++) {
      this.segments.push({ x: x - Math.cos(this.angle) * i * 4, y: y - Math.sin(this.angle) * i * 4 });
    }
  }

  get head() {
    return this.segments[0];
  }

  update() {
    if (!this.alive) return;

    let speed = this.baseSpeed;

    if (this.isPlayer) {
      // Dirección hacia el puntero del jugador
      const dx = mouse.x - canvas.width / 2;
      const dy = mouse.y - canvas.height / 2;
      this.targetAngle = Math.atan2(dy, dx);
      if (mouse.boosting && this.targetLength > 15) {
        speed = this.baseSpeed * 1.65;
        this.targetLength -= 0.05; // Gastar un poco de tamaño al acelerar
      }
    } else {
      // Inteligencia Artificial del Bot
      this.runBotAI();
    }

    // Giro suave hacia el ángulo objetivo
    let diff = this.targetAngle - this.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.angle += diff * 0.12;

    // Nueva posición de la cabeza
    let newX = this.head.x + Math.cos(this.angle) * speed;
    let newY = this.head.y + Math.sin(this.angle) * speed;

    // Rebote suave en los bordes del mapa
    if (newX < 50) { newX = 50; this.targetAngle = 0; }
    if (newX > MAP_SIZE - 50) { newX = MAP_SIZE - 50; this.targetAngle = Math.PI; }
    if (newY < 50) { newY = 50; this.targetAngle = Math.PI / 2; }
    if (newY > MAP_SIZE - 50) { newY = MAP_SIZE - 50; this.targetAngle = -Math.PI / 2; }

    this.segments.unshift({ x: newX, y: newY });
    while (this.segments.length > Math.floor(this.targetLength)) {
      this.segments.pop();
    }
  }

  runBotAI() {
    this.aiTimer--;

    // 1. Detectar peligro cercano (cuerpos de otros gusanos)
    let dangerDetected = false;
    const lookAheadX = this.head.x + Math.cos(this.angle) * 85;
    const lookAheadY = this.head.y + Math.sin(this.angle) * 85;

    for (let other of worms) {
      if (other.id === this.id || !other.alive) continue;
      for (let i = 0; i < other.segments.length; i += 3) {
        const seg = other.segments[i];
        const dist = Math.hypot(lookAheadX - seg.x, lookAheadY - seg.y);
        if (dist < 65) {
          // Girar bruscamente para esquivar
          this.targetAngle += (Math.random() > 0.5 ? 1.4 : -1.4);
          dangerDetected = true;
          break;
        }
      }
      if (dangerDetected) break;
    }

    // 2. Si no hay peligro inmediato, buscar comida o cazar
    if (!dangerDetected && this.aiTimer <= 0) {
      this.aiTimer = 12 + Math.floor(Math.random() * 15);
      let nearestFood = null;
      let minDist = 350;

      for (let f of foods) {
        const d = Math.hypot(f.x - this.head.x, f.y - this.head.y);
        if (d < minDist) {
          minDist = d;
          nearestFood = f;
        }
      }

      if (nearestFood) {
        this.targetAngle = Math.atan2(nearestFood.y - this.head.y, nearestFood.x - this.head.x);
      } else {
        this.targetAngle += (Math.random() - 0.5) * 1.2;
      }
    }
  }

  draw(camX, camY) {
    if (!this.alive) return;

    // Dibujar cuerpo desde la cola hasta la cabeza
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i];
      const screenX = seg.x - camX;
      const screenY = seg.y - camY;

      // Optimización: no dibujar lo que está fuera de pantalla
      if (screenX < -40 || screenX > canvas.width + 40 || screenY < -40 || screenY > canvas.height + 40) continue;

      ctx.beginPath();
      ctx.arc(screenX, screenY, i === 0 ? this.radius + 2 : this.radius, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#ffffff' : this.color;
      
      // Transparencia durante los 10s de preparación (escudo activo)
      ctx.globalAlpha = gameState === 'PREP' ? 0.55 : 1.0;
      ctx.fill();
      ctx.closePath();
    }

    ctx.globalAlpha = 1.0;

    // Nombre y bolívares simulados encima del gusano
    const headScreenX = this.head.x - camX;
    const headScreenY = this.head.y - camY;
    ctx.fillStyle = this.isPlayer ? '#fbbf24' : '#e6edf3';
    ctx.font = 'bold 12px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.name} (Bs.${this.simMoney.toFixed(0)})`, headScreenX, headScreenY - 22);
  }
}

// Generar bolitas de comida
function spawnFood(x, y, value = 1, isLoot = false) {
  foods.push({
    x: x ?? Math.random() * (MAP_SIZE - 100) + 50,
    y: y ?? Math.random() * (MAP_SIZE - 100) + 50,
    radius: isLoot ? 7 : 4,
    value: value,
    color: isLoot ? '#fbbf24' : COLORS[Math.floor(Math.random() * COLORS.length)]
  });
}

// Inicializar partida
function initGame() {
  // Crear al jugador principal
  const player = new Worm('player', 'Tú (Práctica)', true, MAP_SIZE / 2, MAP_SIZE / 2, '#fbbf24');
  worms.push(player);

  // Crear 12 bots simulando usuarios reales
  for (let i = 0; i < BOT_NAMES.length; i++) {
    spawnBot(i);
  }

  // Comida inicial en el mapa
  for (let i = 0; i < 280; i++) {
    spawnFood();
  }
}

function spawnBot(index) {
  const x = Math.random() * (MAP_SIZE - 200) + 100;
  const y = Math.random() * (MAP_SIZE - 200) + 100;
  const name = BOT_NAMES[index % BOT_NAMES.length];
  const color = COLORS[index % COLORS.length];
  worms.push(new Worm('bot-' + index + '-' + Date.now(), name, false, x, y, color));
}

// Temporizador de Fases (10s Preparación -> 60s Combate)
const timerInterval = setInterval(() => {
  if (gameState === 'ENDED') return;

  timeLeft--;
  document.getElementById('timerDisplay').innerText = timeLeft;

  if (timeLeft <= 0) {
    if (gameState === 'PREP') {
      gameState = 'COMBAT';
      timeLeft = 60;
      const phaseEl = document.getElementById('phaseText');
      phaseEl.innerText = '¡COMBATE ACTIVO!';
      phaseEl.style.color = '#ef4444';
      document.getElementById('timerDisplay').innerText = timeLeft;
    } else if (gameState === 'COMBAT') {
      endGame('¡Tiempo Terminado!');
    }
  }
}, 1000);

// Verificar colisiones (solo activas en fase COMBAT)
function checkCollisions() {
  // 1. Comer bolitas
  for (let w of worms) {
    if (!w.alive) continue;
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (Math.hypot(w.head.x - f.x, w.head.y - f.y) < w.radius + f.radius + 4) {
        w.targetLength += f.value * 0.8;
        w.simMoney += f.value * 0.5; // Suma bolívares ficticios al comer
        foods.splice(i, 1);
        if (foods.length < 250) spawnFood();
      }
    }
  }

  // 2. Choques entre gusanos (solo después de los 10s de preparación)
  if (gameState !== 'COMBAT') return;

  for (let attacker of worms) {
    if (!attacker.alive) continue;

    for (let victim of worms) {
      if (attacker.id === victim.id || !victim.alive) continue;

      // Revisar si la cabeza del atacante choca con el cuerpo de la víctima
      for (let i = 2; i < victim.segments.length; i++) {
        const seg = victim.segments[i];
        const dist = Math.hypot(attacker.head.x - seg.x, attacker.head.y - seg.y);

        if (dist < attacker.radius + victim.radius - 4) {
          // El atacante muere al estrellarse contra el cuerpo de la víctima
          killWorm(attacker, victim);
          break;
        }
      }
      if (!attacker.alive) break;
    }
  }
}

function killWorm(deadWorm, killerWorm) {
  deadWorm.alive = false;

  // Premio simulado para el que lo eliminó
  killerWorm.kills++;
  killerWorm.simMoney += 25 + (deadWorm.simMoney * 0.5);

  // Soltar bolitas brillantes donde murió
  for (let i = 0; i < deadWorm.segments.length; i += 2) {
    const seg = deadWorm.segments[i];
    spawnFood(seg.x, seg.y, 3, true);
  }

  if (deadWorm.isPlayer) {
    endGame('¡Te eliminaron!');
  } else {
    // Reaparecer otro bot a los 3 segundos para mantener la sala llena
    setTimeout(() => {
      if (gameState !== 'ENDED') spawnBot(Math.floor(Math.random() * BOT_NAMES.length));
    }, 3000);
  }
}

function updateHUD() {
  const player = worms.find(w => w.isPlayer);
  if (player) {
    document.getElementById('simBalance').innerText = `Bs. ${player.simMoney.toFixed(2)}`;
    document.getElementById('killCount').innerText = player.kills;
  }

  // Actualizar Top 5 en vivo
  const sorted = [...worms].filter(w => w.alive).sort((a, b) => b.simMoney - a.simMoney).slice(0, 5);
  const listEl = document.getElementById('leaderboardList');
  listEl.innerHTML = sorted.map((w, idx) => `
    <li class="${w.isPlayer ? 'is-player' : ''}">
      <span>${idx + 1}. ${w.name}</span>
      <span>Bs. ${w.simMoney.toFixed(0)}</span>
    </li>
  `).join('');
}

function endGame(title) {
  gameState = 'ENDED';
  clearInterval(timerInterval);
  const player = worms.find(w => w.isPlayer);
  document.getElementById('endTitle').innerText = title;
  document.getElementById('finalSimBalance').innerText = `Bs. ${player ? player.simMoney.toFixed(2) : '0.00'}`;
  document.getElementById('endModal').style.display = 'flex';
}

function volverAlDashboard() {
  // Ajusta el nombre si tu panel principal se llama index.html o dashboard.html
  window.location.href = 'dashboard.html';
}

// Bucle principal de animación
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const player = worms.find(w => w.isPlayer) || worms[0];
  const camX = player ? player.head.x - canvas.width / 2 : 0;
  const camY = player ? player.head.y - canvas.height / 2 : 0;

  // Dibujar cuadrícula de fondo para sensación de movimiento
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  const gridSize = 60;
  const offsetX = -camX % gridSize;
  const offsetY = -camY % gridSize;
  for (let x = offsetX; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = offsetY; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Dibujar bordes de la arena
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 4;
  ctx.strokeRect(-camX, -camY, MAP_SIZE, MAP_SIZE);

  // Dibujar comida
  for (let f of foods) {
    const sx = f.x - camX;
    const sy = f.y - camY;
    if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, f.radius, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
  }

  // Actualizar y dibujar gusanos
  for (let w of worms) {
    w.update();
    w.draw(camX, camY);
  }

  checkCollisions();
  updateHUD();

  if (gameState !== 'ENDED') {
    requestAnimationFrame(gameLoop);
  }
}

initGame();
gameLoop();