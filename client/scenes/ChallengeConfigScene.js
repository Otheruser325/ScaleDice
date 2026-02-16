import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import { formatCompact } from '../utils/FormatManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class ChallengeConfigScene extends Phaser.Scene {
  constructor() {
    super('ChallengeConfigScene');
  }

  create() {
    try {
      GlobalErrors.setScene(this);
    } catch (e) {}
    try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}
    try {
      GlobalAchievements.registerScene(this);
    } catch (e) {}

    GlobalLocalization.init(this);
    const settings = GlobalSettings.get(this);
    GlobalLocalization.setLanguage(this, settings.language || 'English');

    const t = (key, fallback) => GlobalLocalization.t(key, fallback);
    const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);

    const config = this.registry.get('challengeConfig') || {};
    const cx = this.cameras.main.centerX;

    this.add.text(cx, 50, `${config.title || t('CHALLENGE_GENERIC', 'CHALLENGE')}`, {
      fontSize: 32,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);

    this.add.text(cx, 100, config.desc || t('CHALLENGE_DESC_FALLBACK', 'Challenge description'), {
      fontSize: 16,
      fontFamily: 'Orbitron, Arial',
      color: '#cccccc',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);

    let y = 150;
    const reward = Number(config.challengeReward || 0);
    if (reward > 0) {
      this.add.text(cx, y, fmt('CHALLENGE_REWARD_LINE', 'Reward: +{0} Tokens', formatCompact(reward)), {
        fontSize: 16,
        fontFamily: 'Orbitron, Arial',
        color: '#ffd966'
      }).setOrigin(0.5);
      y += 26;
    }

    this.add.text(cx, y, fmt('CHALLENGE_PLAYERS', 'Players: {0}', config.players || 2), {
      fontSize: 16,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);
    y += 26;

    this.add.text(cx, y, fmt('CHALLENGE_WAVES', 'Rounds: {0}', config.rounds || 30), {
      fontSize: 16,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);
    y += 26;

    this.add.text(cx, y, fmt('CHALLENGE_COST_MULT', 'Cost Multiplier: x{0}', config.costMult || 1), {
      fontSize: 16,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);
    y += 26;

    this.add.text(cx, y, fmt('CHALLENGE_BIGS', 'Big Upgrades: {0}', config.bigUpgradesEnabled ? t('SET_ON', 'ON') : t('SET_OFF', 'OFF')), {
      fontSize: 16,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);
    y += 26;

    if (config.teamsEnabled) {
      this.add.text(cx, y, t('CHALLENGE_TEAMS_ENABLED', 'Teams: Enabled'), {
        fontSize: 16,
        fontFamily: 'Orbitron, Arial'
      }).setOrigin(0.5);
      y += 26;
    }

    y += 16;
    this.add.text(cx, y, t('CHALLENGE_PLAYERS_LABEL', 'Players:'), {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial'
    }).setOrigin(0.5);
    y += 32;

    for (let i = 0; i < (config.players || 2); i++) {
      const name = config.names?.[i] || `P${i + 1}`;
      const isAI = config.ai?.[i] || false;
      const diff = config.difficulty?.[i] || 'Medium';
      const team = config.teams?.[i] || 'blue';

      const diffLabel = t(`DIFFICULTY_${String(diff).toUpperCase()}`, diff);
      const aiLabel = isAI ? fmt('CHALLENGE_AI_LABEL', 'AI {0}', diffLabel) : t('CHALLENGE_HUMAN_LABEL', 'Human');
      const teamLabel = config.teamsEnabled ? ` - ${t(`TEAM_${String(team).toUpperCase()}`, String(team).toUpperCase())}` : '';
      const line = `${name} (${aiLabel})${teamLabel}`;

      this.add.text(cx, y, line, {
        fontSize: 14,
        fontFamily: 'Orbitron, Arial',
        color: isAI ? '#ff6666' : '#66ff66'
      }).setOrigin(0.5);
      y += 22;
    }

    const viewH = this.cameras.main.height;
    const startBtnY = Math.min(viewH - 90, y + 24);
    const backBtnY = Math.min(viewH - 40, startBtnY + 50);

    this.add.text(cx, startBtnY, t('CHALLENGE_START', 'START CHALLENGE'), {
      fontSize: 22,
      fontFamily: 'Orbitron, Arial',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('LocalGameScene', config);
    });

    this.add.text(cx, backBtnY, t('UI_BACK', '<- BACK'), {
      fontSize: 18,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('ChallengesScene');
    });

    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('ChallengesScene');
    });
  }
}
