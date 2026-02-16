import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ChallengeManager from '../utils/ChallengeManager.js';
import GlobalErrors from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class ChallengesScene extends Phaser.Scene {
  constructor() { super('ChallengesScene'); }

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

    const cx = this.cameras.main.centerX;
    const titleFont = 'Orbitron, Arial';
    const t = (key, fallback) => GlobalLocalization.t(key, fallback);
    const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);

    this.add.text(cx, 80, t('CHALLENGES_TITLE', 'CHALLENGES'), { fontSize: 36, fontFamily: titleFont }).setOrigin(0.5);

    const dailyDateKey = ChallengeManager.getTodayKey();
    const baseRandom = ChallengeManager.getSeededRandom(dailyDateKey);
    const configRandom = ChallengeManager.getSeededRandom(`${dailyDateKey}|daily-config`);

    const buildDailyConfig = () => {
      const random = baseRandom;
      const players = Math.floor(random() * 3) + 2;
      const rounds = Math.floor(random() * 41) + 10;
      const costMult = [0.5, 0.75, 1, 1.25, 1.5][Math.floor(random() * 5)];
      const bigUpgradesEnabled = random() > 0.5;
      const teamsEnabled = players === 4 && random() > 0.5;
      const names = [t('CHALLENGE_PLAYER', 'Player')];
      const ai = [false];
      const difficulty = ['Medium'];
      const teams = ['blue'];

      for (let i = 1; i < players; i++) {
        names.push(`Bot ${i}`);
        ai.push(true);
        difficulty.push(['Easy', 'Medium', 'Hard'][Math.floor(configRandom() * 3)]);
        teams.push(teamsEnabled ? (i % 2 === 0 ? 'blue' : 'red') : 'blue');
      }

      return {
        title: t('CHALLENGE_DAILY_TITLE', 'Daily Challenge'),
        desc: t('CHALLENGE_DAILY_MENU_DESC', 'A random PvC challenge that changes daily.'),
        challengeKey: 'daily',
        challengeDate: dailyDateKey,
        challengeReward: ChallengeManager.getReward('daily'),
        players,
        rounds,
        names,
        ai,
        difficulty,
        teamsEnabled,
        teams,
        costMult,
        bigUpgradesEnabled
      };
    };

    const buildHighStakesConfig = () => ({
      title: t('CHALLENGE_HIGH_STAKES_TITLE', 'High Stakes'),
      desc: t('CHALLENGE_HIGH_STAKES_DESC', 'Face two Medium bots in a high-risk economy sprint. Economy can scale to Lv 250.'),
      challengeKey: 'highStakes',
      challengeReward: ChallengeManager.getReward('highStakes'),
      players: 3,
      rounds: 125,
      names: [t('CHALLENGE_PLAYER', 'Player'), t('CHALLENGE_BROKER_BOT', 'Broker Bot'), t('CHALLENGE_RISK_BOT', 'Risk Bot')],
      ai: [false, true, true],
      difficulty: ['Medium', 'Medium', 'Medium'],
      teamsEnabled: false,
      teams: ['blue', 'red', 'blue'],
      costMult: 0.5,
      bigUpgradesEnabled: true
    });

    const buildDeuciferConfig = () => ({
      title: t('CHALLENGE_DEUCIFER_TITLE', "Deucifer's Pit"),
      desc: t('CHALLENGE_DEUCIFER_MENU_DESC', '50-round veteran challenge against Nightmare Deucifer.'),
      challengeKey: 'deucifer',
      challengeReward: ChallengeManager.getReward('deucifer'),
      players: 2,
      rounds: 50,
      names: [t('CHALLENGE_PLAYER', 'Player'), t('CHALLENGE_DEUCIFER_NAME', 'Deucifer')],
      ai: [false, true],
      difficulty: ['Medium', 'Nightmare'],
      teamsEnabled: false,
      teams: ['blue', 'red'],
      costMult: 1,
      bigUpgradesEnabled: true
    });

    const getStatusStyle = (status) => {
      switch (status) {
        case ChallengeManager.STATUSES.COMPLETE:
          return { label: t('CHALLENGE_COMPLETE', 'COMPLETE'), color: '#66ff66', fill: 0x002200, stroke: 0x00aa00, hover: 0x003300 };
        case ChallengeManager.STATUSES.FAIL:
          return { label: t('CHALLENGE_FAILED', 'FAILED'), color: '#ff6666', fill: 0x220000, stroke: 0xaa0000, hover: 0x330000 };
        default:
          return { label: t('CHALLENGE_NOT_READY', 'NOT READY'), color: '#aaaaaa', fill: 0x222222, stroke: 0x444444, hover: 0x2b2b2b };
      }
    };

    const drawStatusIcon = (x, y, status) => {
      const g = this.add.graphics();
      if (status === ChallengeManager.STATUSES.COMPLETE) {
        g.lineStyle(4, 0x66ff66, 1);
        g.beginPath();
        g.moveTo(x - 10, y + 2);
        g.lineTo(x - 2, y + 10);
        g.lineTo(x + 12, y - 8);
        g.strokePath();
      } else if (status === ChallengeManager.STATUSES.FAIL) {
        g.lineStyle(4, 0xff6666, 1);
        g.beginPath();
        g.moveTo(x - 8, y - 8);
        g.lineTo(x + 8, y + 8);
        g.moveTo(x + 8, y - 8);
        g.lineTo(x - 8, y + 8);
        g.strokePath();
      } else {
        g.lineStyle(3, 0x777777, 1);
        g.strokeCircle(x, y, 8);
      }
      return g;
    };

    const makeChallengeBtn = (y, config, enabled) => {
      const challengeKey = config?.challengeKey || null;
      const showStatus = !!challengeKey;
      const status = showStatus
        ? ChallengeManager.getStatus(challengeKey, { dateKey: config?.challengeDate })
        : ChallengeManager.STATUSES.NOT_READY;
      const statusStyle = getStatusStyle(status);
      const fillColor = enabled ? statusStyle.fill : 0x111111;
      const strokeColor = enabled ? statusStyle.stroke : 0x333333;

      const bg = this.add.rectangle(cx, y, 640, 90, fillColor)
        .setStrokeStyle(2, strokeColor)
        .setOrigin(0.5);

      const reward = Number(config?.challengeReward || 0);
      const rewardSuffix = reward > 0 ? fmt('CHALLENGE_REWARD', ' Reward: +{0} tokens.', reward) : '';
      const titleTxt = this.add.text(cx, y - 18, config?.title || t('CHALLENGE_GENERIC', 'Challenge'), {
        fontSize: 20,
        fontFamily: titleFont,
        color: enabled ? '#ffffff' : '#666666'
      }).setOrigin(0.5);

      const descTxt = this.add.text(cx, y + 12, `${config?.desc || ''}${rewardSuffix}`, {
        fontSize: 14,
        fontFamily: titleFont,
        color: enabled ? '#cccccc' : '#555555',
        align: 'center',
        wordWrap: { width: 600 }
      }).setOrigin(0.5);

      let statusTxt = null;
      if (showStatus) {
        statusTxt = this.add.text(cx + 290, y - 18, statusStyle.label, {
          fontSize: 12,
          fontFamily: titleFont,
          color: enabled ? statusStyle.color : '#666666'
        }).setOrigin(1, 0.5);
        drawStatusIcon(cx - 290, y - 16, status);
      }

      if (enabled) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
          bg.setFillStyle(statusStyle.hover);
          titleTxt.setScale(1.02);
          descTxt.setScale(1.02);
        });
        bg.on('pointerout', () => {
          bg.setFillStyle(statusStyle.fill);
          titleTxt.setScale(1.0);
          descTxt.setScale(1.0);
        });
        bg.on('pointerdown', () => {
          GlobalAudio.playButton(this);
          this.registry.set('challengeConfig', config);
          this.scene.start('ChallengeConfigScene');
        });
      }

      return { bg, titleTxt, descTxt, statusTxt };
    };

    makeChallengeBtn(190, buildDailyConfig(), true);
    makeChallengeBtn(310, buildHighStakesConfig(), true);
    makeChallengeBtn(430, buildDeuciferConfig(), true);
    makeChallengeBtn(550, { title: t('CHALLENGE_COMING_SOON', 'Coming Soon...'), desc: t('CHALLENGE_COMING_SOON_DESC', 'More challenges coming in future updates.') }, false);

    const viewH = this.cameras.main.height;
    const backY = Math.min(viewH - 40, 640);
    this.backBtn = this.add.text(cx, backY, t('UI_BACK', '<- BACK'), {
      fontSize: 20,
      fontFamily: titleFont,
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.backBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });

    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });
  }
}
