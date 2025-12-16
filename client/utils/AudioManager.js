import GlobalSettings from './SettingsManager.js';

class AudioManager {
  constructor() {
    this.music = null;
    this.currentTrack = 0;
    this.tracks = ['dice_league', 'powerhouse', 'energy'];
    this.jukeboxEnabled = false;
    this._onCompleteRef = null;
    this._lastTrackKey = null;
    this._attachedSoundManager = null;
  }

  getSettings(scene) {
    return GlobalSettings.get(scene);
  }

  saveSettings(scene) {
    GlobalSettings.save(scene);
  }

  _settingsOrDefault(scene) {
    return GlobalSettings.get(scene) ?? { music: true, trackIndex: 0, shuffleTrack: false };
  }

  _cleanupMusic() {
    if (!this.music) return;
    try {
      if (this.music.off && this._onCompleteRef) {
        try { this.music.off('complete', this._onCompleteRef); } catch (e) {}
      }
      this.music.stop && this.music.stop();
      this.music.destroy && this.music.destroy();
    } catch (e) {
      // swallow; defensive
    }
    this.music = null;
    this._attachedSoundManager = null;
    this._onCompleteRef = null;
  }

  // ------------ CORE MUSIC PLAYBACK ------------
  playMusic(scene) {
    if (!scene || typeof scene.sound === 'undefined') {
      console.warn('[AudioManager] playMusic called without a valid scene; skipping playback.');
      return;
    }

    const settings = this._settingsOrDefault(scene);
    if (!settings.music) return;

    // Ensure currentTrack originates from settings unless explicitly set
    const desiredIndex = Number.isFinite(settings.trackIndex) ? settings.trackIndex : 0;
    this.currentTrack = ((desiredIndex % this.tracks.length) + this.tracks.length) % this.tracks.length;
    const trackKey = this.tracks[this.currentTrack];

    if (!trackKey) {
      console.warn('[AudioManager] invalid trackKey for index', this.currentTrack);
      this.currentTrack = 0;
      GlobalSettings.set(scene, 'trackIndex', 0);
      return;
    }

    // If already playing the same track on the same sound manager, keep it
    if (this.music && this.music.isPlaying && this._lastTrackKey === trackKey && this._attachedSoundManager === scene.sound) {
      return;
    }

    // Otherwise recreate/attach the music to the provided scene's sound manager
    this._cleanupMusic();
    this._lastTrackKey = trackKey;

    try {
      // loop only when user explicitly chose manual-loop (jukeboxEnabled)
      // BUT: if shuffleTrack is enabled, we never loop single track (we pick a random next on complete)
      const loop = !!this.jukeboxEnabled && !settings.shuffleTrack;

      this.music = scene.sound.add(trackKey, { volume: 0.6, loop });
      this._attachedSoundManager = scene.sound;

      if (!loop) {
        // on complete -> select next track according to settings (shuffle vs sequential)
        this._onCompleteRef = () => {
          this.nextTrack(scene, true);
        };
        // Using `once` so the listener is removed and re-attached each time we create the track
        this.music.once('complete', this._onCompleteRef);
      } else {
        // looping; no complete handler required
        this._onCompleteRef = null;
      }

      this.music.play();
    } catch (e) {
      console.warn('[AudioManager] failed to play music:', e);
      // advance pointer to avoid getting stuck, persist to settings
      this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
      GlobalSettings.set(scene, 'trackIndex', this.currentTrack);
      this._cleanupMusic();
    }
  }

  // manual selection of a specific track index — respects shuffle setting:
  // if shuffleTrack enabled, selecting a track will set trackIndex but NOT force loop.
  setTrack(scene, index) {
    const trackCount = this.tracks.length;
    const clamped = ((index % trackCount) + trackCount) % trackCount;
    GlobalSettings.set(scene, 'trackIndex', clamped);
    this.currentTrack = clamped;

    // If user chose a track manually and shuffle is OFF, enable manual-loop (jukebox)
    const settings = this._settingsOrDefault(scene);
    this.jukeboxEnabled = !!(!settings.shuffleTrack);

    // Recreate and play immediately (on given scene)
    this._cleanupMusic();
    this.playMusic(scene);
  }

  // If you want to go back to auto-cycling (advance tracks on complete) call this
  disableJukebox(scene) {
    this.jukeboxEnabled = false;
    if (scene) GlobalSettings.set(scene, 'trackIndex', this.currentTrack);
    this._cleanupMusic();
    if (scene) this.playMusic(scene);
  }

  // nextTrack(auto) - if auto true, called from 'complete' event; shuffle setting changes behaviour
  nextTrack(scene, auto = false) {
    const settings = this._settingsOrDefault(scene);
    if (auto) {
      if (this.jukeboxEnabled && !settings.shuffleTrack) {
        if (!this.music || !this.music.isPlaying) {
          this.playMusic(scene);
        }
        return;
      }
    }

    this._cleanupMusic();

    if (settings.shuffleTrack) {
      if (this.tracks.length <= 1) {
        this.currentTrack = 0;
      } else {
        let next = this.currentTrack;
        for (let attempts = 0; attempts < 10 && next === this.currentTrack; attempts++) {
          next = Math.floor(Math.random() * this.tracks.length);
        }
        if (next === this.currentTrack) next = (this.currentTrack + 1) % this.tracks.length;
        this.currentTrack = next;
      }
    } else {
      this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
    }

    if (scene) GlobalSettings.set(scene, 'trackIndex', this.currentTrack);

    if (!settings.music) return;

    this.playMusic(scene);
  }

  toggleMusic(scene) {
    const current = GlobalSettings.toggle(scene, 'music');
    GlobalSettings.save(scene);
    if (current) this.playMusic(scene); else this.stopMusic();
    return current;
  }

  stopMusic() {
    this._cleanupMusic();
  }

  // ------------ SFX ------------
  playButton(scene) {
    const settings = this._settingsOrDefault(scene);
    if (!settings.audio) return;
    try { scene.sound.play('button', { volume: 0.5 }); } catch (e) {}
  }

  playDice(scene) {
    const settings = this._settingsOrDefault(scene);
    if (!settings.audio) return;
    try { scene.sound.play('dice', { volume: 0.5 }); } catch (e) {}
  }

  comboSFX(scene, comboName) {
    if (!scene || !scene.sound) return;

    const key = {
      pair: 'combo_pair',
      twoPair: 'combo_pair',
      triple: 'combo_triple',
      straight: 'combo_straight',
      fullHouse: 'combo_fullHouse',
      fourOfAKind: 'combo_fourOfAKind',
      fiveOfAKind: 'combo_fiveOfAKind',
      sixOfAKind: 'combo_fiveOfAKind',
      threePair: 'combo_pair',
      tripleTrend: 'combo_triple',
      powerHouse: 'combo_fullHouse'
    }[comboName];

    if (key) {
      try { scene.sound.play(key, { volume: 0.6 }); } catch (e) {}
    }
  }
}

const GlobalAudio = new AudioManager();
export default GlobalAudio;