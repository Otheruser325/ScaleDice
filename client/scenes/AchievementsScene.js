import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import { formatCompact } from '../utils/FormatManager.js';

export default class AchievementsScene extends Phaser.Scene {
  constructor() {
    super('AchievementsScene');
  }

  create() {
	GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
	
    const centerX = this.cameras.main.centerX;
    const titleY = 60;
    this.add.text(centerX, titleY, 'Achievements', { fontSize: 40, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

    const data = GlobalAchievements.getAll();
    const unlocked = data.unlocked || {};
    const totals = data.totals || {};

    const items = [
      { key: 'firstPlay', title: "I'm New to This", desc: 'Play Scale Dice for the first time.' },
      { key: 'addiction', title: 'Addiction', desc: 'Play Scale Dice for 1 hour total.' },
      { key: 'diceaholic', title: 'Diceaholic', desc: 'Play Scale Dice for 12 hours total.' },
      { key: 'rounds100', title: 'Late Warrior', desc: 'Progress 100 rounds in total.' },
      { key: 'rounds500', title: 'Late Nights', desc: 'Progress 500 rounds in total.' },
      { key: 'score1000', title: "Pilin' Up!", desc: 'Score 1,000 points in a local/online game.' },
      { key: 'score10000', title: "Rackin' Up!", desc: 'Score 10,000 points in a local/online game.' },
      { key: 'score100000', title: 'Hard Labour', desc: 'Score 100,000 points in a local/online game.' },
      { key: 'score1000000', title: 'Millionaire', desc: 'Score 1,000,000 points in a local/online game.' },
      { key: 'score10000000', title: 'Strike It Dice', desc: 'Score 10,000,000 points in a local/online game.' },
      { key: 'fourOfAKind', title: 'Big Shot', desc: 'Roll a Four-of-a-kind combo.' },
      { key: 'fiveOfAKind', title: 'Perfection', desc: 'Roll a Five-of-a-kind combo.' },
      { key: 'sixOfAKind', title: 'Diceomania', desc: 'Roll a Six-of-a-kind combo.' },
      { key: 'funHouse', title: 'Fun House', desc: 'Roll 5 consecutive full/power house combos in a game.' },
      { key: 'roundhouseStraight', title: 'Roundhouse Straight', desc: 'Roll 10 straights in total.' },
      { key: 'maximumPower', title: 'Maximum Power', desc: 'Fully upgrade dice, economy and luck in a game.' }
    ];

    // ---------- SCROLL PANEL CONFIG ----------
    const panelWidth = Math.min(1100, this.cameras.main.width - 120);
    const panelHeight = Math.min(520, this.cameras.main.height - 240);
    const panelLeft = centerX - panelWidth / 2;
    const panelTop = 120;
    const panelPad = 18;

    this.add.rectangle(centerX, panelTop + panelHeight / 2, panelWidth, panelHeight, 0x0f1112, 0.85)
      .setStrokeStyle(2, 0x333333).setDepth(2);

    this.ach = {
      panelLeft,
      panelTop,
      panelWidth,
      panelHeight,
      pad: panelPad,
      cols: 2,
      colGap: 28,
      rowHeight: 82,
      items: [],
      scrollY: 0,
      maxScroll: 0
    };

    const contentWidth = panelWidth - panelPad * 2;
    const colWidth = Math.floor((contentWidth - this.ach.colGap) / this.ach.cols);
	
    this.ach.baseY = panelTop + panelPad;
    this.ach.listContainer = this.add.container(panelLeft + panelPad, this.ach.baseY).setDepth(3);

    let unlockedCount = 0;

    items.forEach((it, i) => {
      const col = i % this.ach.cols;
      const row = Math.floor(i / this.ach.cols);
      const x = col * (colWidth + this.ach.colGap);
      const y = row * this.ach.rowHeight;

      const achieved = !!unlocked[it.key];
      if (achieved) unlockedCount++;

      const titleColor = achieved ? '#66ff66' : '#d7d7d7';
      const descColor = achieved ? '#e6ffe6' : '#bfbfbf';
      const badgeColor = achieved ? '#66ff66' : '#888888';

      const itemContainer = this.add.container(x, y);
      const itemBg = this.add.rectangle(colWidth / 2, this.ach.rowHeight / 2, colWidth, this.ach.rowHeight - 8, 0x0b0b0b, 0.25)
        .setStrokeStyle(1, 0x222222);

      const title = this.add.text(10, 10, it.title, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: titleColor }).setOrigin(0, 0);
      const desc = this.add.text(10, 34, it.desc, {
        fontSize: 12, fontFamily: 'Orbitron, Arial', color: descColor,
        wordWrap: { width: colWidth - 110 }
      }).setOrigin(0, 0);

      const badge = this.add.text(colWidth - 12, 10, achieved ? 'COMPLETED' : 'LOCKED', {
        fontSize: 12, fontFamily: 'Orbitron, Arial', color: badgeColor
      }).setOrigin(1, 0);

      itemContainer.add([itemBg, title, desc, badge]);
      itemContainer.setSize(colWidth, this.ach.rowHeight - 8);
      itemContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, colWidth, this.ach.rowHeight - 8), Phaser.Geom.Rectangle.Contains);
      itemContainer.on('pointerover', () => itemBg.setFillStyle(0x1b1b1b, 0.35));
      itemContainer.on('pointerout', () => itemBg.setFillStyle(0x0b0b0b, 0.25));
      itemContainer.on('pointerdown', () => {
        if (achieved) {
          GlobalAudio.playButton(this);
          const px = panelLeft + panelWidth / 2;
          const py = panelTop + panelHeight - 60;
          const popupRect = this.add.rectangle(px, py, 520, 70, 0x111111, 0.95).setDepth(1200);
          popupRect.setStrokeStyle(2, 0x66ff66);
          const ptitle = this.add.text(px - 240, py - 12, it.title, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#66ff66' }).setDepth(1201).setOrigin(0, 0);
          const pdesc = this.add.text(px - 240, py + 10, it.desc, { fontSize: 12, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setDepth(1201).setOrigin(0, 0);
          this.tweens.add({ targets: [popupRect, ptitle, pdesc], alpha: 1, duration: 160 });
          this.time.delayedCall(1400, () => {
            try { popupRect.destroy(); } catch (e) {}
            try { ptitle.destroy(); } catch (e) {}
            try { pdesc.destroy(); } catch (e) {}
          });
        } else {
          GlobalAudio.playButton(this);
          this.tweens.add({
            targets: itemContainer,
            x: itemContainer.x - 6,
            duration: 60,
            yoyo: true,
            repeat: 0,
            onComplete: () => { itemContainer.x = x; }
          });
        }
      });

      this.ach.listContainer.add(itemContainer);
      this.ach.items.push(itemContainer);
    });

    const rows = Math.ceil(items.length / this.ach.cols);
    const contentHeight = rows * this.ach.rowHeight;
    const visibleHeight = panelHeight - panelPad * 2;
    this.ach.maxScroll = Math.max(0, contentHeight - visibleHeight);

    // ---------- MASK so list won't overflow ----------
    const maskG = this.make.graphics();
    maskG.fillStyle(0xffffff);
    const maskLeft = panelLeft + panelPad;
    const maskTop = panelTop + panelPad;
    maskG.fillRect(maskLeft, maskTop, panelWidth - panelPad * 2, panelHeight - panelPad * 2);
    const mask = maskG.createGeometryMask();
    this.ach.listContainer.setMask(mask);

    // ---------- simple scrollbar visuals (right edge) ----------
    const barX = panelLeft + panelWidth - 10;
    const barTop = panelTop + panelPad;
    const barHeight = panelHeight - panelPad * 2;
    this.ach.scrollbarBg = this.add.rectangle(barX, barTop + barHeight / 2, 8, barHeight, 0x111214, 0.6).setOrigin(0.5).setDepth(4);

    const visibleRatio = Math.max(0.06, Math.min(1, visibleHeight / Math.max(contentHeight, 1)));
    const knobH = Math.max(22, Math.round(barHeight * visibleRatio));
    this.ach.knob = this.add.rectangle(barX, barTop + knobH / 2, 10, knobH, 0x66ff66, 0.9).setOrigin(0.5).setDepth(5).setInteractive();

    this.ach.knob.on('pointerdown', (pointer) => {
      this.ach.knobDrag = { startY: pointer.y, startScroll: this.ach.scrollY };
    });

    this.input.on('pointerup', () => { this.ach.knobDrag = null; });

    this.input.on('pointermove', (pointer) => {
      if (!this.ach.knobDrag) return;
      const dy = pointer.y - this.ach.knobDrag.startY;
      const ratio = dy / (barHeight - knobH);
      this.ach.scrollY = Phaser.Math.Clamp(this.ach.knobDrag.startScroll + ratio * this.ach.maxScroll, 0, this.ach.maxScroll);
      this._updateScroll();
    });

    // ---------- wheel scrolling ----------
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const px = pointer.x;
      const py = pointer.y;
      const left = panelLeft;
      const top = panelTop;
      const right = panelLeft + panelWidth;
      const bottom = panelTop + panelHeight;
      if (px >= left && px <= right && py >= top && py <= bottom) {
        this.ach.scrollY = Phaser.Math.Clamp(this.ach.scrollY + Math.sign(deltaY) * 36, 0, this.ach.maxScroll);
        this._updateScroll();
      }
    });

    this.add.zone(centerX, panelTop + panelHeight / 2, panelWidth, panelHeight).setOrigin(0.5).setInteractive().on('pointerdown', () => {
      this.ach.scrollY = 0;
      this._updateScroll();
    });

    // ---------- stats & footer (fixed; not in scroll) ----------
    const statsY = panelTop + panelHeight + 20;
    this.add.text(centerX, statsY, `Unlocked: ${unlockedCount} / ${items.length}`, { fontSize: 18, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);

    const played = totals.playTimeSeconds || 0;
    const hours = Math.floor(played / 3600);
    const minutes = Math.floor((played % 3600) / 60);
    const timeStr = `${hours}h ${minutes}m`;

    this.add.text(centerX, statsY + 28, `Games: ${totals.gamesPlayed || 0}   Rounds: ${totals.roundsPlayed || 0}   Best: ${formatCompact(totals.bestSingleMatchScore || 0)}`, { fontSize: 16, fontFamily: 'Orbitron, Arial', color: '#ffffff' }).setOrigin(0.5);
    this.add.text(centerX, statsY + 50, `Playtime: ${timeStr}   Straights: ${totals.straightsRolled || 0}`, { fontSize: 14, fontFamily: 'Orbitron, Arial', color: '#cccccc' }).setOrigin(0.5);

    const back = this.add.text(centerX, this.cameras.main.height - 40, '← Back', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      if (GlobalAudio) GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });
	
	this.input.keyboard.on('keydown-ESC', () => {
      if (GlobalAudio) GlobalAudio.playButton(this);
      this.scene.start('MenuScene');
    });

    this._updateScroll();
  }

  _updateScroll() {
    if (!this.ach) return;
    this.ach.scrollY = Phaser.Math.Clamp(this.ach.scrollY, 0, this.ach.maxScroll);
    this.ach.listContainer.y = this.ach.baseY - this.ach.scrollY;

    const barTop = this.ach.panelTop + this.ach.pad;
    const barHeight = this.ach.panelHeight - this.ach.pad * 2;
    const visibleHeight = this.ach.panelHeight - this.ach.pad * 2;
    const contentHeight = Math.ceil(this.ach.items.length / this.ach.cols) * this.ach.rowHeight;
    const visibleRatio = Math.max(0.06, Math.min(1, visibleHeight / Math.max(contentHeight, 1)));
    const knobH = Math.max(22, Math.round(barHeight * visibleRatio));
    const scrollRatio = this.ach.maxScroll > 0 ? (this.ach.scrollY / this.ach.maxScroll) : 0;
    const knobY = barTop + (knobH / 2) + (barHeight - knobH) * scrollRatio;
    if (this.ach.knob) {
      this.ach.knob.setPosition(this.ach.panelLeft + this.ach.panelWidth - 10, knobY);
    }
  }
}