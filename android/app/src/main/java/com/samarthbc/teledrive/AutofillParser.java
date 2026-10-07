package com.samarthbc.teledrive;

import android.app.assist.AssistStructure;
import android.text.InputType;
import android.util.Pair;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Reads a screen another app (or Chrome) wants filled: which fields are usernames, passwords, card or address fields,
 * and the web domain or app. The field kinds are the same names src/autofill/fill.ts uses.
 *
 * In order: the app's autofill hints, a web page's autocomplete/type attributes, the input type, then the field's
 * name, id and hint text. A login's username is also guessed as the text field just before the password.
 */
final class AutofillParser {

    static final class Field {
        final AutofillId id;
        final String kind;
        /** The kind came from an explicit hint or autocomplete attribute (not guessed from a name). */
        final boolean explicit;
        /** What's typed in it (save requests only). */
        final String value;

        Field(AutofillId id, String kind, boolean explicit, String value) {
            this.id = id;
            this.kind = kind;
            this.explicit = explicit;
            this.value = value;
        }
    }

    final List<Field> fields = new ArrayList<>();
    final String packageName;
    String webDomain;
    String webScheme;

    /** Text fields of unknown kind, in screen order (a username before a password, guessed later). */
    private final List<Pair<Integer, Field>> unknown = new ArrayList<>();
    private int order = 0;
    private int firstPassword = -1;

    AutofillParser(AssistStructure structure) {
        packageName = structure.getActivityComponent().getPackageName();
        for (int i = 0; i < structure.getWindowNodeCount(); i++) walk(structure.getWindowNodeAt(i).getRootViewNode());
        finish();
    }

    // ---- what the screen has ----

    boolean has(String kind) {
        for (Field f : fields) if (f.kind.equals(kind)) return true;
        return false;
    }

    /** Worth offering TeleWarden: a password, an explicit username (first step of a sign-in), a card, or an address. */
    boolean fillable() {
        if (has("password") || has("ccNumber")) return true;
        for (Field f : fields) if (f.kind.equals("username") && f.explicit) return true;
        int identity = 0;
        for (String k : kinds()) if (k.matches("name|givenName|familyName|email|phone|address|postal|city|state|country")) identity++;
        return identity >= 2;
    }

    /** The kinds on screen, comma-separated, for the autofill page. */
    String kindList() {
        return String.join(",", kinds());
    }

    Set<String> kinds() {
        Set<String> out = new LinkedHashSet<>();
        for (Field f : fields) out.add(f.kind);
        return out;
    }

    List<AutofillId> ids(String kind) {
        List<AutofillId> out = new ArrayList<>();
        for (Field f : fields) if (f.kind.equals(kind)) out.add(f.id);
        return out;
    }

    /** The first non-empty value typed in a field of this kind (save requests). */
    String value(String kind) {
        for (Field f : fields) if (f.kind.equals(kind) && f.value != null && !f.value.isEmpty()) return f.value;
        return null;
    }

    boolean isWeb() {
        return webDomain != null && !webDomain.isEmpty();
    }

    // ---- reading the views ----

    private void walk(AssistStructure.ViewNode node) {
        if (node == null) return;
        if (webDomain == null && node.getWebDomain() != null && !node.getWebDomain().isEmpty()) {
            webDomain = node.getWebDomain();
            webScheme = node.getWebScheme();
        }
        if (node.getVisibility() == View.VISIBLE) {
            AutofillId id = node.getAutofillId();
            if (id != null && node.getAutofillType() == View.AUTOFILL_TYPE_TEXT && node.isEnabled()) classify(node, id);
            for (int i = 0; i < node.getChildCount(); i++) walk(node.getChildAt(i));
        }
    }

    private void classify(AssistStructure.ViewNode node, AutofillId id) {
        String value = null;
        AutofillValue av = node.getAutofillValue();
        if (av != null && av.isText()) value = av.getTextValue().toString();

        // Web pages: skip what isn't a text box
        ViewStructure.HtmlInfo html = node.getHtmlInfo();
        String type = attr(html, "type");
        if (html != null && !"input".equalsIgnoreCase(html.getTag())) return;
        if (type != null && type.matches("(?i)hidden|submit|button|checkbox|radio|image|reset|file|search|date|number|range|color")) {
            // number inputs can still be card fields (handled by the autocomplete attribute)
            if (!"number".equalsIgnoreCase(type)) return;
        }

        String kind = null;
        boolean explicit = true;
        // 1. Autofill hints (apps) and autocomplete (web pages)
        String[] hints = node.getAutofillHints();
        if (hints != null) for (String h : hints) if (kind == null) kind = fromHint(h);
        if (kind == null) kind = fromHint(attr(html, "autocomplete"));
        // 2. The input's type
        if (kind == null && type != null) {
            if (type.equalsIgnoreCase("password")) kind = "password";
            else if (type.equalsIgnoreCase("email")) kind = "email";
            else if (type.equalsIgnoreCase("tel")) kind = "phone";
        }
        if (kind == null) kind = fromInputType(node.getInputType());
        // 3. Names, ids and hint text
        if (kind == null) {
            explicit = false;
            String words = (str(node.getIdEntry()) + " " + str(node.getHint()) + " " + str(attr(html, "name")) + " " + str(attr(html, "id"))
                + " " + str(attr(html, "placeholder")) + " " + str(attr(html, "aria-label"))).toLowerCase(Locale.ROOT);
            kind = fromWords(words);
        }

        int at = order++;
        if (kind == null) {
            // Only plain text boxes can be a username
            if ((type == null || type.equalsIgnoreCase("text")) && !isMultiline(node.getInputType())) unknown.add(new Pair<>(at, new Field(id, "", false, value)));
            return;
        }
        if (kind.equals("password") && firstPassword < 0) firstPassword = at;
        fields.add(new Field(id, kind, explicit, value));
    }

    /** Login forms: an email field is the username; with no username, the text box just before the password is. */
    private void finish() {
        if (!has("password")) return;
        if (!has("username")) {
            for (int i = 0; i < fields.size(); i++) {
                Field f = fields.get(i);
                if (f.kind.equals("email") || f.kind.equals("phone")) {
                    fields.set(i, new Field(f.id, "username", f.explicit, f.value));
                    return;
                }
            }
            Field before = null;
            for (Pair<Integer, Field> u : unknown) if (u.first < firstPassword) before = u.second;
            if (before != null) fields.add(new Field(before.id, "username", false, before.value));
        }
    }

    private static String fromHint(String hint) {
        if (hint == null || hint.isEmpty()) return null;
        String h = hint.toLowerCase(Locale.ROOT).trim();
        // autocomplete can be "section-x shipping street-address": the last word is the field
        if (h.contains(" ")) h = h.substring(h.lastIndexOf(' ') + 1);
        if (h.equals("off") || h.equals("on")) return null;
        if (h.contains("password")) return "password";
        switch (h) {
            case "username":
            case "nickname":
                return "username";
            case "emailaddress":
            case "email":
                return "email";
            case "creditcardnumber":
            case "cc-number":
                return "ccNumber";
            case "creditcardsecuritycode":
            case "cc-csc":
                return "ccCvc";
            case "creditcardexpirationdate":
            case "cc-exp":
                return "ccExp";
            case "creditcardexpirationmonth":
            case "cc-exp-month":
                return "ccExpMonth";
            case "creditcardexpirationyear":
            case "cc-exp-year":
                return "ccExpYear";
            case "cc-name":
                return "ccName";
            case "name":
            case "personname":
                return "name";
            case "persongivenname":
            case "given-name":
                return "givenName";
            case "personfamilyname":
            case "family-name":
                return "familyName";
            case "phone":
            case "phonenumber":
            case "tel":
            case "tel-national":
                return "phone";
            case "postaladdress":
            case "streetaddress":
            case "street-address":
            case "address-line1":
                return "address";
            case "postalcode":
            case "postal-code":
                return "postal";
            case "addresslocality":
            case "address-level2":
                return "city";
            case "addressregion":
            case "address-level1":
                return "state";
            case "addresscountry":
            case "country":
            case "country-name":
                return "country";
            default:
                return null;
        }
    }

    private static String fromInputType(int t) {
        int cls = t & InputType.TYPE_MASK_CLASS;
        int variation = t & InputType.TYPE_MASK_VARIATION;
        if (cls == InputType.TYPE_CLASS_TEXT) {
            if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) return "password";
            if (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) return "email";
            if (variation == InputType.TYPE_TEXT_VARIATION_PERSON_NAME) return "name";
            if (variation == InputType.TYPE_TEXT_VARIATION_POSTAL_ADDRESS) return "address";
        }
        if (cls == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return "password";
        if (cls == InputType.TYPE_CLASS_PHONE) return "phone";
        return null;
    }

    private static String fromWords(String w) {
        if (w.isBlank()) return null;
        if (w.matches(".*(captcha|search|otp|one.?time|verification|coupon|promo).*")) return null;
        if (w.matches(".*(passw|passwd|pwd|passcode|पासवर्ड).*")) return "password";
        if (w.matches(".*(card.?num|cc.?num|cardno|card_no|credit.?card).*")) return "ccNumber";
        if (w.matches(".*(cvv|cvc|csc|security.?code).*")) return "ccCvc";
        if (w.matches(".*(expir|exp.?date|valid.?thru).*")) return "ccExp";
        if (w.matches(".*(user|login|account|e-?mail|mail).*")) return w.contains("mail") ? "email" : "username";
        return null;
    }

    private static boolean isMultiline(int t) {
        return (t & InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0;
    }

    private static String attr(ViewStructure.HtmlInfo html, String name) {
        if (html == null || html.getAttributes() == null) return null;
        for (Pair<String, String> a : html.getAttributes()) if (name.equalsIgnoreCase(a.first)) return a.second;
        return null;
    }

    private static String str(CharSequence s) {
        return s == null ? "" : s.toString();
    }
}
