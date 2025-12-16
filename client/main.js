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

const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 960,
    parent: 'game-container',
    backgroundColor: '#1f1f1f',
    dom: {
        createContainer: true
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
    ]
};

new Phaser.Game(config);