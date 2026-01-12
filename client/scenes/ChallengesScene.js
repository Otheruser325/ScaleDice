import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';

export default class ChallengesScene extends Phaser.Scene {
  constructor() { super('ChallengesScene'); }

  getSeededRandom(seed) {
    let x = 0;
    for (let i = 0; i < seed.length; i++) {
      x += seed.charCodeAt(i);
    }
    return function() {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
  }
  create() {
    try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}
    try {
      GlobalAchievements.registerScene(this);
    } catch (e) {}
    const cx = this.cameras.main.centerX;
    this.add.text(cx, 80, 'CHALLENGES', { fontSize: 40, fontFamily: 'Orbitron, Arial' }).setOrigin(0.5);

    const makeChallengeBtn = (y, title, desc, enabled, challengeKey) => {
      const completed = challengeKey ? GlobalAchievements.isChallengeCompleted(challengeKey) : false;
      const bg = this.add.rectangle(cx, y, 600, 80, enabled ? (completed ? 0x002200 : 0x222222) : 0x111111).setStrokeStyle(2, enabled ? (completed ? 0x00ff00 : 0x444444) : 0x333333).setOrigin(0.5);
      const displayTitle = completed ? '✓ ' + title : title;
      const titleTxt = this.add.text(cx, y - 15, displayTitle, { fontSize: 24, fontFamily: 'Orbitron, Arial', color: enabled ? (completed ? '#66ff66' : '#ffffff') : '#666666' }).setOrigin(0.5);
      const descTxt = this.add.text(cx, y + 10, desc, { fontSize: 16, fontFamily: 'Orbitron, Arial', color: enabled ? (completed ? '#99ff99' : '#cccccc') : '#555555' }).setOrigin(0.5);
      if (enabled) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => { bg.setFillStyle(completed ? 0x004400 : 0x2b2b2b); titleTxt.setScale(1.02); descTxt.setScale(1.02); });
        bg.on('pointerout',  () => { bg.setFillStyle(completed ? 0x002200 : 0x222222); titleTxt.setScale(1.0); descTxt.setScale(1.0); });
        bg.on('pointerdown', () => { GlobalAudio.playButton(this);
          const config = challengeKey === 'daily' ? (() => {
            const seed = new Date().toDateString();
            const random = this.getSeededRandom(seed);
            const players = Math.floor(random() * 3) + 2;
            const rounds = Math.floor(random() * 41) + 10;
            const costMult = [0.5, 0.75, 1, 1.25, 1.5][Math.floor(random() * 5)];
            const bigUpgradesEnabled = random() > 0.5;
            const teamsEnabled = players === 4 && random() > 0.5;
            const names = ['Player'];
            const ai = [false];
            const difficulty = ['Medium'];
            const teams = ['blue'];
            for (let i = 1; i < players; i++) {
              names.push(`Bot ${i}`);
              ai.push(true);
              difficulty.push(['Easy', 'Medium', 'Hard'][Math.floor(random() * 3)]);
              teams.push(teamsEnabled ? (i % 2 === 0 ? 'blue' : 'red') : 'blue');
            }
            return {
              title: 'Daily Challenge',
              desc: 'A random PvC challenge that changes daily.',
              challengeKey: 'daily',
              players, rounds, names, ai, difficulty, teamsEnabled, teams, costMult, bigUpgradesEnabled
            };
          })() : {
            title: 'Deucifer\'s Pit',
            desc: '50-round veteran challenge against Nightmare Deucifer.',
            challengeKey: 'deucifer',
            players: 2, rounds: 50, names: ['Player', 'Deucifer'], ai: [false, true], difficulty: ['Medium', 'Nightmare'], teamsEnabled: false, teams: ['blue', 'red'], costMult: 1, bigUpgradesEnabled: true
          };
          this.registry.set("challengeConfig", config);
          this.scene.start('ChallengeConfigScene');
        });
      }
      return { bg, titleTxt, descTxt };
    };

    makeChallengeBtn(180, 'Daily Challenge', 'Random daily PvC challenge against computer.', true, 'daily');

    makeChallengeBtn(280, 'Deucifer\'s Pit', '50-round veteran challenge against Deucifer.', true, 'deucifer');

    makeChallengeBtn(380, 'Coming Soon...', 'More challenges coming in future updates.', false, null);

    this.backBtn = this.add.text(cx, 520, '← BACK', { fontSize: 26, fontFamily: 'Orbitron, Arial', color: '#ff6666' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
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