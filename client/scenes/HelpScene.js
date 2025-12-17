import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class HelpScene extends Phaser.Scene {
  constructor() {
    super('HelpScene');
  }

  create() {
	GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
	
    this.popupOpen = false;
    const centerX = this.cameras.main.centerX;

    this.add.text(centerX, 70, 'Help', {
      fontSize: '52px',
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.add.text(centerX, 130, 'How to Play Scale Dice', {
      fontSize: '32px',
      fontFamily: 'Orbitron, Arial',
      color: '#ffff66'
    }).setOrigin(0.5);

    const helpLines = [
      "Scale Dice is an incremental, turn-based strategy dice game. The objective is simple:",
      "score as many points as possible over the match by rolling dice and exploiting combos and upgrades.",
      "",
      "Every turn you roll your available dice. The sum of those faces becomes your base score for the turn.",
      "Certain face combinations (combos) multiply your base score — the rarer the combo, the bigger the multiplier.",
      "",
      "There are three key upgrades available during a match:",
      "• Dice — increases how many dice you roll (more dice → higher raw base score potential).",
      "• Economy — increases passive income per turn so you can afford upgrades faster.",
      "• Luck — raises your chance of getting better faces / small rerolls (helps nudge combos).",
      "",
      "Combo upgrades unlock once you reach specific dice counts; each upgrade increases that combo's multiplier",
      "by ~10% per level (linear) and can be bought multiple times during the same match.",
      "",
      "Single-player or teams: highest score wins. Have fun optimizing purchases vs rolling risk!"
    ];

    this.add.text(centerX, 470, helpLines.join('\n'), {
      fontSize: '20px',
      fontFamily: 'Orbitron, Arial',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 760 }
    }).setOrigin(0.5);

    this.comboBtn = this.add.text(this.cameras.main.width - 40, 40, 'Special Rules', {
      fontSize: '20px',
      fontFamily: 'Orbitron, Arial',
      color: '#ffdd66'
    })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });

    this.comboBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.showRulesPopup();
    });

    this.backBtn = this.add.text(centerX, 820, '← Back', {
      fontSize: 28,
      fontFamily: 'Orbitron, Arial',
      color: '#ff6666'
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.backBtn.on('pointerdown', () => {
      if (this.popupOpen) return;
      GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });

    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      if (this.popupOpen) {
        this._destroyPopup();
      } else {
        this.scene.start('MenuScene');
      }
    });
  }

  showRulesPopup() {
    if (this.popupOpen) return;
    this.popupOpen = true;

    this.backBtn.disableInteractive();
    if (this.comboBtn) this.comboBtn.disableInteractive();

    this._popupEntities = [];

    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;

    const popupW = 760;
    const popupH = 420;

    const bg = this.add.rectangle(centerX, centerY, popupW, popupH, 0x0a0a0a, 0.95)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(1000);
    this._popupEntities.push(bg);

    const title = this.add.text(centerX, centerY - popupH / 2 + 36, 'Special Rules', {
      fontSize: '32px',
      fontFamily: 'Orbitron, Arial',
      color: '#ffff66'
    }).setOrigin(0.5).setDepth(1001);
    this._popupEntities.push(title);

    const rulesText = [
      "Teams:",
      "Red vs Blue style matches can be enabled in a lobby.",
      "Each team's score is the sum of all its players' scores.",
      "The team with the highest total score wins.",
      "",
      "Cost Mult:",
      "Adjusts the price of upgrades globally during a match.",
      "Lower values create faster, more chaotic games.",
      "Higher values slow progression and reward long-term strategy."
    ];

    const body = this.add.text(
      centerX,
      centerY,
      rulesText.join('\n'),
      {
        fontSize: '20px',
        fontFamily: 'Orbitron, Arial',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: popupW - 80 }
      }
    ).setOrigin(0.5).setDepth(1001);

    this._popupEntities.push(body);

    const closeBtn = this.add.text(
      centerX,
      centerY + popupH / 2 - 36,
      'Close',
      {
        fontSize: '24px',
        fontFamily: 'Orbitron, Arial',
        color: '#ff6666'
      }
    )
      .setOrigin(0.5)
      .setDepth(1001)
      .setInteractive({ useHandCursor: true });

    closeBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this._destroyPopup();
    });

    this._popupEntities.push(closeBtn);
  }

  _destroyPopup() {
    if (Array.isArray(this._popupEntities)) {
      this._popupEntities.forEach(o => {
        try { o.destroy(); } catch (e) {}
      });
    }

    this._popupEntities = null;
    this.popupOpen = false;

    try { this.backBtn.setInteractive(); } catch (e) {}
    try { if (this.comboBtn) this.comboBtn.setInteractive(); } catch (e) {}
  }
}