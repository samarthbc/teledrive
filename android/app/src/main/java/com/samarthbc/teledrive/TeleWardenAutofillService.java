package com.samarthbc.teledrive;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.app.assist.AssistStructure;
import android.app.slice.Slice;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.InlinePresentation;
import android.service.autofill.SaveCallback;
import android.service.autofill.SaveInfo;
import android.service.autofill.SaveRequest;
import android.util.Log;
import android.view.autofill.AutofillId;
import android.widget.RemoteViews;
import android.widget.inline.InlinePresentationSpec;

import androidx.autofill.inline.UiVersions;
import androidx.autofill.inline.v1.InlineSuggestionUi;

import java.util.ArrayList;
import java.util.List;

/**
 * TeleWarden as Android's autofill service (IMPLEMENTATION.md → "Phase 23"). This side never sees a decrypted item:
 * it offers one locked suggestion ("TeleWarden · Tap to unlock and fill"); tapping it opens AutofillActivity, where
 * the vault is unlocked and a login picked, and that activity hands Android the values.
 *
 * Saving: after a sign-in Android asks "Save to TeleWarden?"; Save opens TeleDrive with the login to save.
 */
public class TeleWardenAutofillService extends AutofillService {

    private static final String TAG = "TeleWardenAutofill";

    static final String EXTRA_KIND = "kind";
    static final String EXTRA_TARGET = "target";
    static final String EXTRA_LABEL = "label";
    static final String EXTRA_FIELDS = "fields";
    static final String EXTRA_IDS = "ids";
    static final String EXTRA_ID_KINDS = "idKinds";

    static final String EXTRA_SAVE_KIND = "telewarden.save.kind";
    static final String EXTRA_SAVE_TARGET = "telewarden.save.target";
    static final String EXTRA_SAVE_LABEL = "telewarden.save.label";
    static final String EXTRA_SAVE_USERNAME = "telewarden.save.username";
    static final String EXTRA_SAVE_PASSWORD = "telewarden.save.password";

    private static int requestCode = 1;

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancellation, FillCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
            AutofillParser screen = new AutofillParser(structure);
            // Not TeleDrive itself, and only screens worth filling
            if (screen.packageName.equals(getPackageName()) || !screen.fillable()) {
                callback.onSuccess(null);
                return;
            }

            Intent open = new Intent(this, AutofillActivity.class);
            open.putExtra(EXTRA_KIND, screen.isWeb() ? "web" : "app");
            open.putExtra(EXTRA_TARGET, screen.isWeb() ? screen.webDomain : screen.packageName);
            open.putExtra(EXTRA_LABEL, screen.isWeb() ? screen.webDomain : appName(this, screen.packageName));
            open.putExtra(EXTRA_FIELDS, screen.kindList());
            ArrayList<AutofillId> ids = new ArrayList<>();
            ArrayList<String> idKinds = new ArrayList<>();
            for (AutofillParser.Field f : screen.fields) {
                ids.add(f.id);
                idKinds.add(f.kind);
            }
            open.putParcelableArrayListExtra(EXTRA_IDS, ids);
            open.putStringArrayListExtra(EXTRA_ID_KINDS, idKinds);
            // Mutable: Android adds the screen to it when it starts the activity
            IntentSender sender = PendingIntent.getActivity(this, requestCode++, open,
                PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_MUTABLE).getIntentSender();

            boolean login = screen.has("password") || screen.has("username");
            String subtitle = login ? "Tap to unlock and fill" : screen.has("ccNumber") ? "Fill a card" : "Fill from an identity";
            Dataset.Builder dataset = new Dataset.Builder(presentation(this, "TeleWarden", subtitle));
            for (AutofillId id : ids) dataset.setValue(id, null);
            InlinePresentation inline = inline(request, "TeleWarden", subtitle);
            if (inline != null) dataset.setInlinePresentation(inline);
            dataset.setAuthentication(sender);

            FillResponse.Builder response = new FillResponse.Builder().addDataset(dataset.build());
            // "Save to TeleWarden?" after signing in
            List<AutofillId> passwords = screen.ids("password");
            if (!passwords.isEmpty()) {
                List<AutofillId> usernames = screen.ids("username");
                SaveInfo.Builder save = new SaveInfo.Builder(
                    SaveInfo.SAVE_DATA_TYPE_PASSWORD | (usernames.isEmpty() ? 0 : SaveInfo.SAVE_DATA_TYPE_USERNAME),
                    passwords.toArray(new AutofillId[0]));
                if (!usernames.isEmpty()) save.setOptionalIds(usernames.toArray(new AutofillId[0]));
                // Apps that sign in without leaving the screen
                save.setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE);
                response.setSaveInfo(save.build());
            }
            callback.onSuccess(response.build());
        } catch (Exception e) {
            Log.w(TAG, "Fill request failed", e);
            callback.onSuccess(null);
        }
    }

    @Override
    public void onSaveRequest(SaveRequest request, SaveCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
            AutofillParser screen = new AutofillParser(structure);
            String password = screen.value("password");
            if (password == null) {
                callback.onSuccess();
                return;
            }
            // Earlier screens of the same sign-in may hold the username (username first, then password)
            String username = screen.value("username");
            for (int i = contexts.size() - 2; username == null && i >= 0; i--) username = new AutofillParser(contexts.get(i).getStructure()).value("username");

            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra(EXTRA_SAVE_KIND, screen.isWeb() ? "web" : "app");
            intent.putExtra(EXTRA_SAVE_TARGET, screen.isWeb() ? screen.webDomain : screen.packageName);
            intent.putExtra(EXTRA_SAVE_LABEL, screen.isWeb() ? screen.webDomain : appName(this, screen.packageName));
            intent.putExtra(EXTRA_SAVE_USERNAME, username == null ? "" : username);
            intent.putExtra(EXTRA_SAVE_PASSWORD, password);
            // TeleDrive opens on top of the app that was signed in to, with the login to save
            callback.onSuccess(PendingIntent.getActivity(this, requestCode++, intent,
                PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE).getIntentSender());
        } catch (Exception e) {
            Log.w(TAG, "Save request failed", e);
            callback.onFailure("TeleWarden couldn't save this login");
        }
    }

    /** The app's name as the phone shows it, or its package name. */
    static String appName(Context ctx, String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(info).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    /** The suggestion in Android's autofill dropdown. */
    static RemoteViews presentation(Context ctx, String title, String subtitle) {
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.autofill_item);
        views.setTextViewText(R.id.autofill_title, title);
        views.setTextViewText(R.id.autofill_subtitle, subtitle);
        return views;
    }

    /** The same suggestion above the keyboard (Android 11+, keyboards that support it). */
    @SuppressLint("RestrictedApi")
    private InlinePresentation inline(FillRequest request, String title, String subtitle) {
        if (Build.VERSION.SDK_INT < 30 || request.getInlineSuggestionsRequest() == null) return null;
        List<InlinePresentationSpec> specs = request.getInlineSuggestionsRequest().getInlinePresentationSpecs();
        if (specs.isEmpty()) return null;
        InlinePresentationSpec spec = specs.get(0);
        if (!UiVersions.getVersions(spec.getStyle()).contains(UiVersions.INLINE_UI_VERSION_1)) return null;
        PendingIntent attribution = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Slice slice = InlineSuggestionUi.newContentBuilder(attribution)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setStartIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .build()
            .getSlice();
        return new InlinePresentation(slice, spec, false);
    }
}
