import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import HelpScene from './scenes/HelpScene.js';
import AchievementsScene from './scenes/AchievementsScene.js';
import ChangelogScene from './scenes/ChangelogScene.js';
import PlayModeScene from './scenes/PlayModeScene.js';
import LocalConfigScene from './scenes/LocalConfigScene.js';
import LocalGameScene from './scenes/LocalGameScene.js';
import LocalPostGameScene from './scenes/LocalPostGameScene.js';
import OnlineMenuScene from './scenes/OnlineMenuScene.js';
import ChallengesScene from './scenes/ChallengesScene.js';

const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 960,
    parent: 'game-container',
    backgroundColor: '#1f1f1f',
    dom: {
        createContainer: true
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1280,
      height: 960
    },
    scene: [
        PreloadScene,
        MenuScene,
        SettingsScene,
		HelpScene,
		AchievementsScene,
        ChangelogScene,
        PlayModeScene,
        LocalConfigScene,
        LocalGameScene,
		LocalPostGameScene,
        OnlineMenuScene,
        ChallengesScene
    ]
};

new Phaser.Game(config);