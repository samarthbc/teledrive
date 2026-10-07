package com.samarthbc.teledrive;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import java.security.KeyStore;
import java.util.Arrays;
import java.util.function.Consumer;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * TeleWarden's secrets on the phone, shared by the app (TeleDriveNativePlugin) and the autofill window
 * (AutofillActivity): fingerprint unlock and copying a password without it showing up.
 *
 * Fingerprint unlock: the vault key is encrypted with a Keystore key that only works right after a fingerprint
 * (BiometricPrompt with a CryptoObject). Adding a fingerprint to the phone makes that key unusable.
 */
final class VaultSecrets {

    private static final String BIO_ALIAS = "telewarden_bio";
    private static final String BIO_PREFS = "telewarden_bio";

    /** Which copy is the latest (a newer copy cancels the older one's clearing). */
    private static int clipSerial = 0;

    private VaultSecrets() {}

    /** How a fingerprint request ended: the data (unlock), done (enable), cancelled, or an error with a code. */
    interface Done {
        void ok(String data);

        void cancelled();

        void failed(String message, String code);
    }

    /** { available, enrolled } */
    static boolean[] biometricAvailable(Context ctx) {
        int r = BiometricManager.from(ctx).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        return new boolean[] {r == BiometricManager.BIOMETRIC_SUCCESS, r != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED};
    }

    /** Turn on fingerprint unlock: encrypt `data` (the vault key, base64) after a fingerprint. */
    static void biometricEnable(FragmentActivity activity, String dataB64, Done done) {
        byte[] data = Base64.decode(dataB64, Base64.NO_WRAP);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, bioKey(true));
            prompt(activity, "Turn on fingerprint unlock", cipher, done, c -> {
                try {
                    byte[] ct = c.doFinal(data);
                    prefs(activity).edit()
                        .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                        .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                        .apply();
                    done.ok(null);
                } catch (Exception e) {
                    done.failed(e.getMessage(), null);
                } finally {
                    Arrays.fill(data, (byte) 0);
                }
            });
        } catch (Exception e) {
            Arrays.fill(data, (byte) 0);
            done.failed(e.getMessage(), null);
        }
    }

    /** The vault key (base64) after a fingerprint. */
    static void biometricUnlock(FragmentActivity activity, Done done) {
        SharedPreferences prefs = prefs(activity);
        String iv = prefs.getString("iv", null);
        String ct = prefs.getString("ct", null);
        if (iv == null || ct == null) {
            done.failed("Fingerprint unlock isn't set up", "NOT_SET");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, bioKey(false), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            prompt(activity, "Unlock TeleWarden", cipher, done, c -> {
                try {
                    done.ok(Base64.encodeToString(c.doFinal(Base64.decode(ct, Base64.NO_WRAP)), Base64.NO_WRAP));
                } catch (Exception e) {
                    done.failed(e.getMessage(), null);
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            // A fingerprint was added or removed: set it up again with the master password
            biometricDisable(activity);
            done.failed("Fingerprints changed on this phone. Unlock with your master password and turn fingerprint unlock on again.", "INVALIDATED");
        } catch (Exception e) {
            done.failed(e.getMessage(), null);
        }
    }

    static void biometricDisable(Context ctx) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(BIO_ALIAS);
        } catch (Exception ignored) {
        }
        prefs(ctx).edit().clear().apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(BIO_PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey bioKey(boolean fresh) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!fresh && ks.containsAlias(BIO_ALIAS)) return (SecretKey) ks.getKey(BIO_ALIAS, null);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(BIO_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        kg.init(spec.build());
        return kg.generateKey();
    }

    private static void prompt(FragmentActivity activity, String title, Cipher cipher, Done done, Consumer<Cipher> then) {
        activity.runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("TeleWarden")
                .setNegativeButtonText("Use master password")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                        if (crypto == null || crypto.getCipher() == null) done.failed("Fingerprint unlock failed", null);
                        else then.accept(crypto.getCipher());
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        if (code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_CANCELED) done.cancelled();
                        else done.failed(message.toString(), null);
                    }
                });
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    /**
     * Copy a secret: marked sensitive, so the keyboard's clipboard strip and Android's preview don't show it, and
     * cleared after `clearAfter` seconds (0 = never) if it's still what's on the clipboard.
     */
    static void copySecret(Context context, String text, long clearAfter) {
        Context ctx = context.getApplicationContext();
        new Handler(Looper.getMainLooper()).post(() -> {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("TeleWarden", text);
            PersistableBundle extras = new PersistableBundle();
            // ClipDescription.EXTRA_IS_SENSITIVE from Android 13; keyboards read the same key on older versions
            extras.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : "android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
            cm.setPrimaryClip(clip);
            int mine = ++clipSerial;
            if (clearAfter > 0) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (mine != clipSerial) return;
                    // In the background Android may not let the app read the clipboard: then it's cleared anyway
                    ClipData now = cm.getPrimaryClip();
                    CharSequence current = now != null && now.getItemCount() > 0 ? now.getItemAt(0).getText() : null;
                    if (now != null && (current == null || !current.toString().equals(text))) return;
                    if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                    else cm.setPrimaryClip(ClipData.newPlainText("", ""));
                }, clearAfter * 1000);
            }
        });
    }
}
