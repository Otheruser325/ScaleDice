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
import OnlineAccountScene from './scenes/OnlineAccountScene.js';
import OnlineConfigScene from './scenes/OnlineConfigScene.js';
import OnlineLobbyScene from './scenes/OnlineLobbyScene.js';
import OnlineGameScene from './scenes/OnlineGameScene.js';
import OnlinePostGameScene from './scenes/OnlinePostGameScene.js';
import ChallengesScene from './scenes/ChallengesScene.js';
import ChallengeConfigScene from './scenes/ChallengeConfigScene.js';
import { getSocket } from './utils/SocketManager.js';

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
        LocalGameScene,        LocalPostGameScene,
        OnlineMenuScene,
        OnlineAccountScene,
        OnlineConfigScene,
        OnlineLobbyScene,
        OnlineGameScene,
        OnlinePostGameScene,
        ChallengesScene,
        ChallengeConfigScene
    ]
};

const game = new Phaser.Game(config);

// Browser smoke tests need to drive real Phaser scenes without reaching into
// module internals. Keep this opt-in so normal players never get a global
// handle to the game or socket.
if (new URLSearchParams(window.location.search).get('test') === '1') {
    window.__SCALE_DICE_TEST__ = { game, getSocket };
}
