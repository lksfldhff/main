<?php
/**
 * Vermittler zwischen der Seite und dem Sprachmodell.
 *
 * Liegt diese Datei neben der HTML-Datei auf dem Webspace, findet die Seite
 * sie von selbst und benutzt sie. Dann gilt:
 *
 *   - Besucher brauchen KEINEN eigenen Schluessel; die Seite laeuft sofort.
 *   - Der Schluessel steht hier auf dem Server und nie im Browser.
 *   - Der Aufruf laeuft ueber die eigene Adresse, also gibt es kein CORS.
 *
 * Ohne diese Datei funktioniert die Seite weiterhin -- dann traegt jeder
 * Besucher seinen eigenen Schluessel ein.
 *
 * ---------------------------------------------------------------------------
 * WICHTIG: Wer die Adresse kennt, verbraucht das Guthaben des Schluessels.
 * Bei einer oeffentlich erreichbaren Seite unbedingt ein Zugangswort setzen
 * (BERNIE_ZUGANG) oder die Seite hinter einen Passwortschutz legen.
 * ---------------------------------------------------------------------------
 *
 * Einstellen entweder hier unten oder ueber Umgebungsvariablen.
 */

declare(strict_types=1);

// ============================== Einstellungen ==============================

/** Der API-Schluessel. Am Praefix wird der Anbieter erkannt. */
$SCHLUESSEL = getenv('BERNIE_SCHLUESSEL') ?: '';

/** Optionales Zugangswort. Leer lassen = jeder darf. */
$ZUGANG = getenv('BERNIE_ZUGANG') ?: '';

/** Abweichender Modellname; leer lassen fuer die Voreinstellung des Anbieters. */
$MODELL = getenv('BERNIE_MODELL') ?: '';

/**
 * Nur bei Claude: wie gruendlich das Modell nachdenken soll -- und damit,
 * was ein Aufruf kostet. 'low' reicht fuer das Umschreiben von Texten und
 * ist am guenstigsten; 'medium' ist der Mittelweg, 'high' das Maximum.
 */
$AUFWAND = getenv('BERNIE_AUFWAND') ?: 'low';

/** Hoechstens so viele Anfragen je Stunde und Absender. */
$PRO_STUNDE = 60;

/** Laengere Eingaben werden abgewiesen. */
$MAX_ZEICHEN = 20000;

// ===========================================================================

const ANBIETER = [
    ['praefix' => 'sk-ant-', 'name' => 'Claude',
     'adresse' => 'https://api.anthropic.com/v1/messages',
     'modell' => 'claude-opus-5', 'format' => 'anthropic'],
    ['praefix' => 'gsk_', 'name' => 'Groq',
     'adresse' => 'https://api.groq.com/openai/v1/chat/completions',
     'modell' => 'llama-3.3-70b-versatile', 'format' => 'openai'],
    ['praefix' => 'sk-or-', 'name' => 'OpenRouter',
     'adresse' => 'https://openrouter.ai/api/v1/chat/completions',
     'modell' => 'meta-llama/llama-3.3-70b-instruct:free', 'format' => 'openai'],
    ['praefix' => 'sk-', 'name' => 'OpenAI',
     'adresse' => 'https://api.openai.com/v1/chat/completions',
     'modell' => 'gpt-4o-mini', 'format' => 'openai'],
];

header('content-type: application/json; charset=utf-8');
header('cache-control: no-store');
header('x-content-type-options: nosniff');

/** Antwortet und beendet die Verarbeitung. */
function antworten(array $nutzlast, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($nutzlast, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function anbieter_zu(string $schluessel): ?array
{
    foreach (ANBIETER as $eintrag) {
        if (str_starts_with($schluessel, $eintrag['praefix'])) {
            return $eintrag;
        }
    }
    return null;
}

/**
 * Einfache Bremse gegen Dauerfeuer: je Absender so viele Anfragen je Stunde.
 * Reicht fuer eine kleine Seite; wer mehr braucht, nimmt einen Passwortschutz.
 */
function bremse_frei(int $pro_stunde): bool
{
    if ($pro_stunde <= 0) {
        return true;
    }
    $absender = $_SERVER['REMOTE_ADDR'] ?? 'unbekannt';
    $datei = sys_get_temp_dir() . '/bernie-' . hash('sha256', $absender) . '.txt';
    $jetzt = time();
    $zeiten = [];
    if (is_readable($datei)) {
        $roh = (array) json_decode((string) file_get_contents($datei), true);
        $zeiten = array_filter($roh, static fn($t): bool => is_int($t) && $t > $jetzt - 3600);
    }
    if (count($zeiten) >= $pro_stunde) {
        return false;
    }
    $zeiten[] = $jetzt;
    @file_put_contents($datei, json_encode(array_values($zeiten)), LOCK_EX);
    return true;
}

/** Schickt eine Anfrage an den Anbieter und liefert [Status, Daten, Netzfehler]. */
function anbieter_anfragen(string $adresse, array $kopf, ?array $koerper): array
{
    $verbindung = curl_init($adresse);
    $einstellungen = [
        CURLOPT_HTTPHEADER => $kopf,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
    ];
    if ($koerper !== null) {
        $einstellungen[CURLOPT_POST] = true;
        $einstellungen[CURLOPT_POSTFIELDS] = json_encode($koerper, JSON_UNESCAPED_UNICODE);
    }
    curl_setopt_array($verbindung, $einstellungen);
    $antwort = curl_exec($verbindung);
    $status = (int) curl_getinfo($verbindung, CURLINFO_RESPONSE_CODE);
    $netzfehler = curl_error($verbindung);
    curl_close($verbindung);
    if ($antwort === false) {
        return [0, null, $netzfehler];
    }
    return [$status, json_decode((string) $antwort, true), ''];
}

/**
 * Fragt den Anbieter, welche Modelle es gibt.
 *
 * Anbieter tauschen ihre Modelle regelmaessig aus; ein fest eingetragener
 * Name veraltet. Statt zu raten, wird nachgeschaut.
 */
function modelle_holen(array $eintrag, string $schluessel): array
{
    $adresse = preg_replace('#/(chat/completions|messages)$#', '/models', $eintrag['adresse']);
    $kopf = $eintrag['format'] === 'anthropic'
        ? ['x-api-key: ' . $schluessel, 'anthropic-version: 2023-06-01']
        : ['authorization: Bearer ' . $schluessel];
    [$status, $daten] = anbieter_anfragen((string) $adresse, $kopf, null);
    if ($status < 200 || $status >= 300 || !is_array($daten)) {
        return [];
    }
    $liste = $daten['data'] ?? [];
    $namen = [];
    foreach ($liste as $modell) {
        $name = is_array($modell) ? (string) ($modell['id'] ?? '') : (string) $modell;
        if ($name !== '') {
            $namen[] = $name;
        }
    }
    return $namen;
}

/**
 * Waehlt aus einer Modellliste das brauchbarste Sprachmodell.
 *
 * Aussortiert wird, was keinen Text schreibt (Spracherkennung, Sprachausgabe,
 * Einbettungen, Schutzfilter). Bevorzugt werden grosse Instruktionsmodelle.
 */
function modell_waehlen(array $namen): string
{
    $raus = ['whisper', 'tts', 'guard', 'embed', 'moderation', 'rerank', 'vision-preview', 'distil-whisper'];
    $punkte = ['405b' => 9, '120b' => 8, '70b' => 7, 'maverick' => 7, 'large' => 6, 'k2' => 6,
               '32b' => 5, 'scout' => 5, 'versatile' => 4, '20b' => 3, 'instruct' => 2, '8b' => 1];
    $beste = '';
    $bestwert = -1;
    foreach ($namen as $name) {
        $klein = strtolower($name);
        foreach ($raus as $wort) {
            if (str_contains($klein, $wort)) {
                continue 2;
            }
        }
        $wert = 0;
        foreach ($punkte as $wort => $gewicht) {
            if (str_contains($klein, $wort)) {
                $wert += $gewicht;
            }
        }
        if ($wert > $bestwert) {
            $bestwert = $wert;
            $beste = $name;
        }
    }
    return $beste;
}

/**
 * Bestimmt das Modell, das wirklich benutzt wird.
 *
 * Ist keins fest eingetragen, wird beim Anbieter nachgesehen: existiert die
 * Voreinstellung noch, bleibt es dabei, sonst wird das naechstbeste genommen.
 * Das Ergebnis haelt eine Stunde, damit nicht jeder Seitenaufruf nachfragt.
 */
function modell_bestimmen(array $eintrag, string $schluessel, string $fest): string
{
    if ($fest !== '') {
        return $fest;
    }
    $datei = sys_get_temp_dir() . '/bernie-modell-' . hash('sha256', $eintrag['name'] . $schluessel) . '.txt';
    if (is_readable($datei) && filemtime($datei) > time() - 3600) {
        $gemerkt = trim((string) file_get_contents($datei));
        if ($gemerkt !== '') {
            return $gemerkt;
        }
    }
    $gewaehlt = $eintrag['modell'];
    $namen = modelle_holen($eintrag, $schluessel);
    if ($namen && !in_array($eintrag['modell'], $namen, true)) {
        $gewaehlt = modell_waehlen($namen) ?: $eintrag['modell'];
    }
    @file_put_contents($datei, $gewaehlt, LOCK_EX);
    return $gewaehlt;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    antworten(['fehler' => 'Nur POST.'], 405);
}

$roh = file_get_contents('php://input') ?: '';
$anfrage = json_decode($roh, true);
if (!is_array($anfrage)) {
    antworten(['fehler' => 'Die Anfrage war nicht lesbar.'], 400);
}

$eintrag = anbieter_zu($SCHLUESSEL);
$bereit = $eintrag !== null;

// Die Seite fragt beim Laden, ob dieser Vermittler einsatzbereit ist.
if (!empty($anfrage['pruefen'])) {
    antworten([
        'bereit' => $bereit,
        'anbieter' => $bereit ? $eintrag['name'] : '',
        'modell' => $bereit ? modell_bestimmen($eintrag, $SCHLUESSEL, $MODELL) : '',
        'zugang_noetig' => $ZUGANG !== '',
        'grund' => $bereit ? '' : 'Auf dem Server ist kein Schluessel hinterlegt (api.php, Zeile "SCHLUESSEL").',
    ]);
}

if (!$bereit) {
    antworten(['fehler' => 'Auf dem Server ist kein gueltiger Schluessel hinterlegt.'], 503);
}

// Zum Nachsehen, welche Modelle das eigene Konto anbietet.
if (!empty($anfrage['modelle'])) {
    $namen = modelle_holen($eintrag, $SCHLUESSEL);
    antworten([
        'anbieter' => $eintrag['name'],
        'modelle' => $namen,
        'vorschlag' => modell_waehlen($namen),
    ]);
}
if ($ZUGANG !== '' && !hash_equals($ZUGANG, (string) ($anfrage['zugang'] ?? ''))) {
    antworten(['fehler' => 'Falsches Zugangswort.'], 401);
}
if (!bremse_frei($PRO_STUNDE)) {
    antworten(['fehler' => "Zu viele Anfragen. Hoechstens $PRO_STUNDE je Stunde."], 429);
}

$system = (string) ($anfrage['system'] ?? '');
$nutzer = (string) ($anfrage['nutzer'] ?? '');
if (trim($nutzer) === '') {
    antworten(['fehler' => 'Kein Text uebergeben.'], 400);
}
if (mb_strlen($system) + mb_strlen($nutzer) > $MAX_ZEICHEN) {
    antworten(['fehler' => 'Der Text ist zu lang.'], 413);
}

$modell = modell_bestimmen($eintrag, $SCHLUESSEL, $MODELL);

/** Baut Kopfzeilen und Rumpf fuer ein bestimmtes Modell. */
$bauen = static function (string $modell) use ($eintrag, $SCHLUESSEL, $system, $nutzer, $AUFWAND): array {
    if ($eintrag['format'] === 'anthropic') {
        return [
            ['content-type: application/json', 'x-api-key: ' . $SCHLUESSEL, 'anthropic-version: 2023-06-01'],
            [
                'model' => $modell,
                'max_tokens' => 8000,
                'system' => $system,
                'messages' => [['role' => 'user', 'content' => $nutzer]],
                // Die aktuellen Claude-Modelle denken von sich aus mit; gesteuert
                // wird das ueber den Aufwand. Temperatur gibt es dort nicht mehr.
                'output_config' => ['effort' => $AUFWAND],
            ],
        ];
    }
    return [
        ['content-type: application/json', 'authorization: Bearer ' . $SCHLUESSEL],
        [
            'model' => $modell,
            // Knapp halten: kostenlose Kontingente rechnen den angeforderten
            // Rahmen voll gegen das Minutenbudget, auch wenn er ungenutzt bleibt.
            'max_tokens' => 1000,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $nutzer],
            ],
        ],
    ];
};

[$kopf, $koerper] = $bauen($modell);
[$status, $daten, $netzfehler] = anbieter_anfragen($eintrag['adresse'], $kopf, $koerper);

// Anbieter mustern ihre Modelle regelmaessig aus. Statt mit einem veralteten
// Namen zu scheitern, wird einmal nachgeschaut und das Passende genommen.
$gewechselt = false;
$meldung = $daten['error']['message'] ?? '';
if (
    $MODELL === ''
    && in_array($status, [400, 404], true)
    && (is_string($meldung) ? stripos($meldung, 'model') !== false : true)
) {
    $ersatz = modell_waehlen(modelle_holen($eintrag, $SCHLUESSEL));
    if ($ersatz !== '' && $ersatz !== $modell) {
        $modell = $ersatz;
        $gewechselt = true;
        [$kopf, $koerper] = $bauen($modell);
        [$status, $daten, $netzfehler] = anbieter_anfragen($eintrag['adresse'], $kopf, $koerper);
    }
}

if ($status === 0) {
    antworten(['fehler' => 'Keine Verbindung zum Anbieter: ' . $netzfehler], 502);
}

if ($status < 200 || $status >= 300) {
    $meldung = $daten['error']['message'] ?? $daten['error'] ?? '';
    $texte = [
        400 => 'Die Anfrage wurde abgelehnt (400).',
        401 => 'Der hinterlegte Schluessel wird nicht akzeptiert (401).',
        403 => 'Zugriff verweigert (403).',
        404 => 'Modell nicht gefunden (404).',
        429 => 'Das Minutenkontingent ist aufgebraucht.',
        529 => 'Der Dienst ist ueberlastet (529).',
    ];
    $text = $texte[$status] ?? "Der Anbieter antwortete mit Status $status.";

    // Bei einer Bremse nennt der Anbieter die Wartezeit -- die gehoert in die
    // Antwort, damit die Seite etwas Sinnvolles anzeigen kann.
    if ($status === 429) {
        $sekunden = 0;
        if (is_string($meldung) && preg_match('/try again in ([\d.]+)s/i', $meldung, $treffer)) {
            $sekunden = (int) ceil((float) $treffer[1]);
        }
        antworten([
            'fehler' => $text . ($sekunden > 0 ? " Noch $sekunden Sekunden." : ' Kurz warten.'),
            'warten' => $sekunden,
        ], 429);
    }

    if (in_array($status, [400, 404], true)) {
        $namen = modelle_holen($eintrag, $SCHLUESSEL);
        if ($namen) {
            $text .= ' Verfuegbar waeren: ' . implode(', ', array_slice($namen, 0, 8))
                . '. Eintragen in api.php unter MODELL.';
        }
    }
    antworten(['fehler' => $text . (is_string($meldung) && $meldung !== '' ? ' Meldung: ' . $meldung : '')], 502);
}

// Anthropic liefert Bloecke, OpenAI-kompatible Dienste "choices".
if (isset($daten['content']) && is_array($daten['content'])) {
    $teile = array_map(
        static fn(array $block): string => (string) ($block['text'] ?? ''),
        array_filter($daten['content'], static fn($b): bool => is_array($b) && ($b['type'] ?? '') === 'text')
    );
    $text = implode("\n", $teile);
} else {
    $text = (string) ($daten['choices'][0]['message']['content'] ?? '');
}

if (trim($text) === '') {
    antworten(['fehler' => 'Die Antwort des Modells war leer.'], 502);
}

antworten([
    'text' => trim($text),
    'anbieter' => $eintrag['name'],
    'modell' => $modell,
    'modell_gewechselt' => $gewechselt,
]);
