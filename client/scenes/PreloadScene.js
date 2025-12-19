import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalFonts from '../utils/FontManager.js';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  _delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  preload() {
    this.cameras.main.setBackgroundColor('#000000');

    this._fontPromise = GlobalFonts.init([
      { family: 'Orbitron', url: 'assets/fonts/Orbitron-Regular.ttf', weight: '400' },
      { family: 'Orbitron', url: 'assets/fonts/Orbitron-Medium.ttf',  weight: '500' },
      { family: 'Orbitron', url: 'assets/fonts/Orbitron-SemiBold.ttf', weight: '600' },
      { family: 'Orbitron', url: 'assets/fonts/Orbitron-Bold.ttf',     weight: '700' }
    ], { timeout: 1000 }).catch(err => {
      console.warn('GlobalFonts.init failed (continuing):', err);
    });

    const titleStyle = { fontSize: '64px', color: '#ffffff', fontFamily: 'Orbitron, Arial' };
    const loadingStyle = { fontSize: '20px', color: '#000000', fontFamily: 'Orbitron, Arial' };

    this.add.text(600, 100, 'SCALE DICE', titleStyle).setOrigin(0.5);

    const barX = 600 - 150;
    const barY = 350;
    const barW = 300;
    const barH = 30;

    const progressBarBg = this.add.rectangle(600, barY, barW, barH, 0x444444).setOrigin(0.5);
    const progressBarFill = this.add.rectangle(barX, barY, 0, barH, 0xFFEE55).setOrigin(0, 0.5);
    this.loadingPercent = this.add.text(600, barY, '0%', loadingStyle).setOrigin(0.5);
    this.loadingText = this.add.text(600, 300, 'Loading...', { fontSize: '28px', color: '#ffffff', fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

    this.load.on('progress', (value) => {
      progressBarFill.width = Math.max(2, Math.round(barW * value));
      this.loadingPercent.setText(`${Math.round(value * 100)}%`);
    });

    this.load.on('complete', async () => {
      try {
        const waitMs = 1000;
        await Promise.race([
          this._fontPromise || Promise.resolve(),
          this._delay(waitMs)
        ]);
      } catch (e) {
        console.warn('Font wait race error (continuing):', e);
      }

      try {
        const style = { fontFamily: 'Orbitron, Arial' };
        if (this.titleText && this.titleText.setStyle) this.titleText.setStyle(style);
        if (this.loadingText && this.loadingText.setStyle) this.loadingText.setStyle(style);
        if (this.loadingPercent && this.loadingPercent.setStyle) this.loadingPercent.setStyle(style);
      } catch (e) {}

      this.tweens.add({
        targets: [this.progressBarBg, this.progressBarFill, this.loadingPercent, this.loadingText, this.titleText],
        alpha: 0,
        duration: 400,
        onComplete: () => {
          this.time.delayedCall(150, () => this.scene.start('MenuScene'));
        }
      });
    });

    GlobalBackground.createBackgroundPanel(this, { width: 920, height: 760, useImageIfAvailable: false });

    // ---- Assets ----
    this.load.audio('button', 'assets/audio/button.mp3');
    this.load.audio('dice', 'assets/audio/dice.mp3');
    this.load.audio('combo_pair', 'assets/audio/combo_pair.mp3');
    this.load.audio('combo_triple', 'assets/audio/combo_triple.mp3');
    this.load.audio('combo_fullHouse', 'assets/audio/combo_fullHouse.mp3');
    this.load.audio('combo_fourOfAKind', 'assets/audio/combo_fourOfAKind.mp3');
    this.load.audio('combo_fiveOfAKind', 'assets/audio/combo_fiveOfAKind.mp3');
    this.load.audio('combo_straight', 'assets/audio/combo_straight.mp3');
    this.load.audio('dice_league', 'assets/music/dice_league.mp3');
    this.load.audio('snake_theme', 'assets/music/snake_theme.mp3');
    this.load.audio('gravitor_theme', 'assets/music/gravitor_theme.mp3');
    this.load.audio('basilisk_theme', 'assets/music/basilisk_theme.mp3');

    this.load.json('changelog', 'config/changelog.json');

    this.load.image('bg', 'assets/bg/Background-floor.png');

    this.load.image('dice1', 'assets/dice/dice-six-faces-one.png');
    this.load.image('dice2', 'assets/dice/dice-six-faces-two.png');
    this.load.image('dice3', 'assets/dice/dice-six-faces-three.png');
    this.load.image('dice4', 'assets/dice/dice-six-faces-four.png');
    this.load.image('dice5', 'assets/dice/dice-six-faces-five.png');
    this.load.image('dice6', 'assets/dice/dice-six-faces-six.png');

    this.load.image('settingsIcon', 'assets/ui/settings.png');
    this.load.image('achievementIcon', 'assets/ui/achievement.png');
    this.load.image('helpIcon', 'assets/ui/help.png');
    this.load.image('changelogIcon', 'assets/ui/changelog.png');
    this.load.image('playerIcon', 'assets/ui/player.png');
    this.load.image('botIcon', 'assets/ui/robot.png');
  }

  create() {
    GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });

    const saved = JSON.parse(localStorage.getItem('scaleDice_settings')) || {};
    const defaults = {
      audio: true,
      music: true,
      visualEffects: true,
      shuffleTrack: false,
      trackIndex: 0
    };

    this.registry.set('settings', { ...defaults, ...saved });
  }
}