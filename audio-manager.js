// Audio Manager for Noda System
// Handles audio playback with iOS compatibility

class AudioManager {
    constructor() {
        this.sounds = {
            beep: null,
            alert: null,
            success: null
        };
        this.initialized = false;
        this.currentMode = null; // 'inventory', 'picking', 'nyuko'
    }

    // Initialize audio elements
    init() {
        console.log('🔊 Initializing Audio Manager...');
        
        // Create audio elements
        this.sounds.beep = new Audio('beep.mp3');
        this.sounds.alert = new Audio('alert.mp3');
        this.sounds.success = new Audio('success.mp3');

        // Set properties for all sounds
        Object.values(this.sounds).forEach(audio => {
            audio.preload = 'auto';
            audio.volume = 0; // Start muted for iOS compatibility
        });

        this.initialized = true;
        console.log('✅ Audio Manager initialized');
    }

    // Pre-play audio silently when entering a work mode (iOS workaround)
    async activateForMode(mode) {
        if (!this.initialized) {
            this.init();
        }

        this.currentMode = mode;
        console.log(`🔊 Activating audio for mode: ${mode}`);

        try {
            // Determine which sounds this mode needs
            let soundsToActivate = [];
            
            if (mode === 'inventory' || mode === 'nyuko') {
                soundsToActivate = ['beep', 'alert'];
            } else if (mode === 'picking') {
                soundsToActivate = ['alert', 'success'];
            }

            // Play each sound silently to unlock iOS audio
            for (const soundName of soundsToActivate) {
                const audio = this.sounds[soundName];
                if (audio) {
                    audio.volume = 0; // Ensure muted
                    audio.currentTime = 0;
                    
                    try {
                        await audio.play();
                        console.log(`✅ Pre-activated ${soundName} sound (silent)`);
                        // Pause immediately after playing starts
                        audio.pause();
                        audio.currentTime = 0;
                    } catch (error) {
                        console.log(`⚠️ Could not pre-activate ${soundName}:`, error.message);
                    }
                }
            }

            console.log(`✅ Audio activated for ${mode} mode`);
        } catch (error) {
            console.error('❌ Error activating audio:', error);
        }
    }

    // Play a sound with full volume
    async play(soundName) {
        if (!this.initialized) {
            console.warn('⚠️ Audio not initialized, initializing now...');
            this.init();
        }

        const audio = this.sounds[soundName];
        if (!audio) {
            console.error(`❌ Sound "${soundName}" not found`);
            return;
        }

        try {
            // Reset and play with full volume
            audio.currentTime = 0;
            audio.volume = 1.0;
            
            await audio.play();
            console.log(`🔊 Playing ${soundName} sound`);

            // Auto-mute after playing finishes
            audio.onended = () => {
                console.log(`🔇 ${soundName} finished playing, muting`);
                audio.volume = 0;
                audio.currentTime = 0;
            };

        } catch (error) {
            console.error(`❌ Error playing ${soundName}:`, error);
        }
    }

    // Stop and mute a sound
    stop(soundName) {
        const audio = this.sounds[soundName];
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 0;
            console.log(`🔇 Stopped and muted ${soundName}`);
        }
    }

    // Stop all sounds
    stopAll() {
        Object.keys(this.sounds).forEach(soundName => {
            this.stop(soundName);
        });
        console.log('🔇 All sounds stopped');
    }

    // Mute a specific sound without stopping
    mute(soundName) {
        const audio = this.sounds[soundName];
        if (audio) {
            audio.volume = 0;
            console.log(`🔇 Muted ${soundName}`);
        }
    }

    // Play beep sound (for successful scans in inventory/nyuko)
    playBeep() {
        this.play('beep');
    }

    // Play alert sound (for errors)
    playAlert() {
        this.play('alert');
    }

    // Play success sound (for picking completion)
    playSuccess() {
        this.play('success');
    }

    // Stop alert and mute (when error modal closes)
    stopAlert() {
        this.stop('alert');
    }

    // Stop success and mute (when success modal closes)
    stopSuccess() {
        this.stop('success');
    }
}

// Create global instance
const audioManager = new AudioManager();

// Export for use in other scripts
window.audioManager = audioManager;
