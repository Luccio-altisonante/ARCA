#include "api.hpp"

#include "anagrammi_indicizzati.hpp"
#include "comandi.hpp"
#include "ordinamento_rimario.hpp"
#include "sha256.hpp"
#include "testo.hpp"

#include <algorithm>
#include <cctype>
#include <limits>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <type_traits>
#include <unordered_set>
#include <utility>

namespace anagrammi {

namespace {

Words vocabolario_da_testo(const std::string& text) {
    Words words;
    std::stringstream ss(text);
    std::string line;

    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        line = normalizza_testo(line);
        if (!line.empty()) {
            words.push_back(line);
        }
    }

    return words;
}

RisultatoComando messaggio_comando(
    std::string tipo,
    std::string message,
    std::string parola_modificata,
    bool vocabolario_modificato,
    bool richiede_salvataggio) {
    RisultatoComando result;
    result.tipo = std::move(tipo);
    result.messaggio = std::move(message);
    result.parola_modificata = std::move(parola_modificata);
    result.vocabolario_modificato = vocabolario_modificato;
    result.richiede_salvataggio = richiede_salvataggio;
    return result;
}

} // namespace

VocabolarioConIdentita carica_vocabolario_ordinato_con_identita(std::string_view bytes) {
    std::string hash = dettaglio::sha256_esadecimale(dettaglio::sha256(
        reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size()));

    // Il parser esistente conserva il BOM: il round-trip da solo non lo rifiuta.
    if (bytes.substr(0, 3) == "\xef\xbb\xbf") {
        throw std::invalid_argument("Vocabolario non canonico: BOM UTF-8 non ammesso");
    }

    MotoreAnagrammi lettore;
    lettore.carica_vocabolario_ordinato_da_testo(std::string(bytes));
    if (lettore.esporta_vocabolario_testo() != bytes) {
        throw std::invalid_argument("Vocabolario non canonico: il parsing modifica i byte sorgente");
    }
    return {lettore.vocabolario(), std::move(hash)};
}

MotoreAnagrammi::MotoreAnagrammi(Words vocabulary) {
    sostituisci_vocabolario(std::move(vocabulary));
}

MotoreAnagrammi::MotoreAnagrammi(const MotoreAnagrammi& altro)
    : vocabulary_(altro.vocabulary_),
      identita_vocabolario_sha256_(altro.identita_vocabolario_sha256_),
      runtime_sillabe_(altro.runtime_sillabe_),
      fonte_sillabe_(altro.fonte_sillabe_),
      profilo_sillabe_(altro.profilo_sillabe_),
      sola_lettura_(altro.sola_lettura_),
      ordinato_rimario_(altro.ordinato_rimario_) {}

MotoreAnagrammi& MotoreAnagrammi::operator=(const MotoreAnagrammi& altro) {
    snapshot_.reset();
    if (this != &altro) {
        MotoreAnagrammi copia(altro);
        scambia_stato(copia);
    }
    return *this;
}

MotoreAnagrammi::MotoreAnagrammi(MotoreAnagrammi&& altro) noexcept {
    scambia_stato(altro);
}

MotoreAnagrammi& MotoreAnagrammi::operator=(MotoreAnagrammi&& altro) noexcept {
    snapshot_.reset();
    if (this != &altro) {
        MotoreAnagrammi nuovo(std::move(altro));
        scambia_stato(nuovo);
    }
    return *this;
}

void MotoreAnagrammi::scambia_stato(MotoreAnagrammi& altro) noexcept {
    snapshot_.reset();
    altro.snapshot_.reset();
    vocabulary_.swap(altro.vocabulary_);
    identita_vocabolario_sha256_.swap(altro.identita_vocabolario_sha256_);
    runtime_sillabe_.swap(altro.runtime_sillabe_);
    fonte_sillabe_.swap(altro.fonte_sillabe_);
    profilo_sillabe_.swap(altro.profilo_sillabe_);
    std::swap(sola_lettura_, altro.sola_lettura_);
    std::swap(ordinato_rimario_, altro.ordinato_rimario_);
}

void MotoreAnagrammi::invalida_identita_e_runtime() noexcept {
    snapshot_.reset();
    identita_vocabolario_sha256_.reset();
    runtime_sillabe_.reset();
    fonte_sillabe_.reset();
}

void MotoreAnagrammi::sostituisci_vocabolario(Words vocabulary) {
    invalida_identita_e_runtime();
    vocabulary_ = normalizza_vocabolario(vocabulary);
    profilo_sillabe_.reset();
    ordinato_rimario_ = false;
}

void MotoreAnagrammi::carica_vocabolario_da_testo(const std::string& text) {
    auto parole = vocabolario_da_testo(text);
    invalida_identita_e_runtime();
    vocabulary_ = std::move(parole);
    profilo_sillabe_.reset();
    ordina_rimario(vocabulary_);
    ordinato_rimario_ = true;
}

void MotoreAnagrammi::carica_vocabolario_ordinato_da_testo(const std::string& text) {
    auto parole = vocabolario_da_testo(text);
    invalida_identita_e_runtime();
    vocabulary_ = std::move(parole);
    profilo_sillabe_.reset();
    ordinato_rimario_ = true;
}

void MotoreAnagrammi::carica_vocabolario_ordinato_con_identita(std::string_view bytes) {
    auto caricato = anagrammi::carica_vocabolario_ordinato_con_identita(bytes);
    std::optional<std::string> identita(std::move(caricato.sha256));
    // Tutte le operazioni fallibili precedono il commit dello stato.
    snapshot_.reset();
    vocabulary_.swap(caricato.parole);
    identita_vocabolario_sha256_.swap(identita);
    runtime_sillabe_.reset();
    fonte_sillabe_.reset();
    profilo_sillabe_.reset();
    ordinato_rimario_ = true;
}

void MotoreAnagrammi::associa_runtime_sillabe(RuntimeSillabe runtime) {
    if (!identita_vocabolario_sha256_) {
        throw std::invalid_argument("Runtime sillabico: vocabolario senza identita' SHA-256");
    }
    if (*identita_vocabolario_sha256_ != runtime.vocabolario_sha256()) {
        throw std::invalid_argument("Runtime sillabico: SHA-256 del vocabolario diverso");
    }
    if (vocabulary_.size() != runtime.numero_grafie()) {
        throw std::invalid_argument("Runtime sillabico: numero di grafie incoerente");
    }
    std::optional<RuntimeSillabe> nuovo(std::move(runtime));
    runtime_sillabe_.swap(nuovo);
    fonte_sillabe_.reset();
    profilo_sillabe_.reset();
}

const std::optional<std::string>& MotoreAnagrammi::identita_vocabolario_sha256() const noexcept {
    return identita_vocabolario_sha256_;
}

bool MotoreAnagrammi::ha_runtime_sillabe() const noexcept {
    return runtime_sillabe_.has_value();
}

const RuntimeSillabe* MotoreAnagrammi::runtime_sillabe() const noexcept {
    return runtime_sillabe_ ? &*runtime_sillabe_ : nullptr;
}

void MotoreAnagrammi::prepara_sillabe_personali() {
    ProfiloSillabePersonale nuovo(vocabulary_);
    invalida_identita_e_runtime();
    profilo_sillabe_ = std::move(nuovo);
}

void MotoreAnagrammi::prepara_sillabe_personali_da_ufficiale(const MotoreAnagrammi& ufficiale) {
    if (!ufficiale.ha_runtime_sillabe()) {
        throw std::logic_error("Profilo personale: fonte senza runtime compatibile associato");
    }
    if (!ufficiale.fonte_sillabe_) {
        ufficiale.fonte_sillabe_ = std::make_shared<const FonteSillabeUfficiali>(
            ufficiale.vocabulary_, *ufficiale.runtime_sillabe_);
    }
    ProfiloSillabePersonale nuovo(vocabulary_, ufficiale.fonte_sillabe_);
    invalida_identita_e_runtime();
    profilo_sillabe_ = std::move(nuovo);
}

bool MotoreAnagrammi::ha_profilo_sillabe_personale() const noexcept {
    return profilo_sillabe_.has_value();
}

void MotoreAnagrammi::applica_modifiche(const Words& parole_rimosse, const Words& parole_aggiunte) {
    if (sola_lettura_) {
        return;
    }
    std::unordered_set<std::string> rimosse;
    rimosse.reserve(parole_rimosse.size());
    for (const auto& word : parole_rimosse) {
        const std::string normalized = normalizza_testo(word);
        if (!normalized.empty()) {
            rimosse.insert(normalized);
        }
    }

    Words ricostruito;
    ricostruito.reserve(vocabulary_.size() + parole_aggiunte.size());
    std::unordered_set<std::string> presenti;
    presenti.reserve(vocabulary_.size() + parole_aggiunte.size());

    for (const auto& word : vocabulary_) {
        if (rimosse.find(word) == rimosse.end() && presenti.insert(word).second) {
            ricostruito.push_back(word);
        }
    }

    for (const auto& word : parole_aggiunte) {
        const std::string normalized = normalizza_testo(word);
        if (!normalized.empty() && presenti.insert(normalized).second) {
            ricostruito.push_back(normalized);
        }
    }

    if (!parole_aggiunte.empty()) {
        ordina_rimario(ricostruito);
    }
    std::optional<ProfiloSillabePersonale> profilo;
    if (profilo_sillabe_) profilo.emplace(ricostruito, profilo_sillabe_->fonte());
    invalida_identita_e_runtime();
    vocabulary_.swap(ricostruito);
    profilo_sillabe_.swap(profilo);
    if (!parole_aggiunte.empty()) ordinato_rimario_ = true;
}

const Words& MotoreAnagrammi::vocabolario() const {
    return vocabulary_;
}

std::size_t MotoreAnagrammi::numero_parole() const {
    return vocabulary_.size();
}

std::string MotoreAnagrammi::esporta_vocabolario_testo() const {
    std::ostringstream output;
    for (const auto& word : vocabulary_) {
        output << word << '\n';
    }
    return output.str();
}

void MotoreAnagrammi::imposta_sola_lettura(bool sola_lettura) {
    sola_lettura_ = sola_lettura;
}

bool MotoreAnagrammi::sola_lettura() const {
    return sola_lettura_;
}

bool MotoreAnagrammi::aggiungi_parola(const std::string& word) {
    if (sola_lettura_) {
        return false;
    }
    std::string normalizzata = normalizza_testo(word);
    if (normalizzata.empty() ||
        std::find(vocabulary_.begin(), vocabulary_.end(), normalizzata) != vocabulary_.end()) return false;
    if (!ordinato_rimario_) {
        // Il raro percorso non ordinato lavora su una copia, senza ricalcolare le voci.
        MotoreAnagrammi copia(*this);
        std::vector<std::size_t> indici(vocabulary_.size());
        std::iota(indici.begin(), indici.end(), 0);
        std::stable_sort(indici.begin(), indici.end(), [&](auto a, auto b) {
            return rimario_less(vocabulary_[a], vocabulary_[b]);
        });
        Words ordinate;
        ordinate.reserve(vocabulary_.size());
        for (auto i : indici) ordinate.push_back(vocabulary_[i]);
        copia.vocabulary_.swap(ordinate);
        if (copia.profilo_sillabe_) copia.profilo_sillabe_->riordina(indici);
        copia.ordinato_rimario_ = true;
        copia.aggiungi_parola(normalizzata);
        scambia_stato(copia);
        return true;
    }
    const auto posizione = std::lower_bound(vocabulary_.begin(), vocabulary_.end(), normalizzata, rimario_less);
    const auto indice = static_cast<std::size_t>(posizione - vocabulary_.begin());
    if (vocabulary_.size() == vocabulary_.max_size()) throw std::length_error("Vocabolario troppo grande");
    if (vocabulary_.size() == vocabulary_.capacity()) {
        vocabulary_.reserve(vocabulary_.size() + std::min(
            std::max<std::size_t>(1, vocabulary_.size() / 2), vocabulary_.max_size() - vocabulary_.size()));
    }
    // Dopo l'inserimento nel profilo il commit Words non alloca e usa solo move noexcept.
    static_assert(std::is_nothrow_move_constructible_v<std::string> &&
        std::is_nothrow_move_assignable_v<std::string>);
    if (profilo_sillabe_) profilo_sillabe_->inserisci(indice, normalizzata);
    vocabulary_.insert(vocabulary_.begin() + indice, std::move(normalizzata));
    invalida_identita_e_runtime();
    return true;
}

bool MotoreAnagrammi::rimuovi_parola(const std::string& word) {
    if (sola_lettura_) {
        return false;
    }
    const std::string normalizzata = normalizza_testo(word);
    if (std::find(vocabulary_.begin(), vocabulary_.end(), normalizzata) == vocabulary_.end()) return false;
    // Rimuove tutte le copie della grafia, come l'API storica, mantenendo gli indici allineati.
    for (std::size_t i = vocabulary_.size(); i > 0; --i) {
        if (vocabulary_[i - 1] != normalizzata) continue;
        if (profilo_sillabe_) profilo_sillabe_->rimuovi(i - 1);
        vocabulary_.erase(vocabulary_.begin() + (i - 1));
    }
    invalida_identita_e_runtime();
    return true;
}

Words MotoreAnagrammi::cerca_anagrammi_con_filtro_sillabe(
    const std::string& parola, std::size_t lunghezza, const FiltroSillabe& filtro) const {
    if (!runtime_sillabe_ && !profilo_sillabe_) {
        throw std::logic_error("Filtro sillabico: nessun RuntimeSillabe compatibile associato");
    }
    const auto candidati = dettaglio::cerca_anagrammi_indicizzati(
        vocabulary_, normalizza_testo(parola), lunghezza);
    const auto filtrati = dettaglio::applica_filtro_sillabe_opzionale(candidati, runtime_sillabe(), &filtro,
        profilo_sillabe_ ? &*profilo_sillabe_ : nullptr);
    return dettaglio::formatta_anagrammi(vocabulary_, filtrati);
}

RisultatoComando MotoreAnagrammi::esegui_comando(const std::string& raw_command) {
    return esegui_comando_impl(raw_command, nullptr);
}

RisultatoComando MotoreAnagrammi::esegui_comando_con_filtro_sillabe(
    const std::string& command, const FiltroSillabe& filtro) {
    return esegui_comando_impl(command, &filtro);
}

MotoreAnagrammi::PreparazioneComando MotoreAnagrammi::prepara_comando(
    const std::string& raw_command, const FiltroSillabe* filtro) {
    snapshot_.reset();
    if (filtro && !runtime_sillabe_ && !profilo_sillabe_) {
        throw std::logic_error("Filtro sillabico: nessun RuntimeSillabe compatibile associato");
    }
    const std::string command = normalizza_testo(raw_command);

    if (command.empty()) {
        PreparazioneComando result;
        result.metadati.tipo = "vuoto";
        return result;
    }

    if (command.size() > 2 && command[0] == '+' && std::isspace(static_cast<unsigned char>(command[1]))) {
        if (filtro) {
            throw std::invalid_argument("Filtro sillabico: i comandi di modifica non sono ammessi");
        }
        const std::string word = normalizza_testo(command.substr(2));
        if (sola_lettura_) {
            return {messaggio_comando(
                "sola_lettura",
                "Il vocabolario originale e' in sola lettura. Crea o usa un vocabolario personale per modificarlo.",
                word,
                false,
                false), {}, false};
        }
        const bool added = aggiungi_parola(word);
        return {messaggio_comando(
            "aggiunta",
            added ? word + " aggiunta al vocabolario." : word + " e' gia' nel vocabolario o non e' valida.",
            word,
            added,
            added), {}, false};
    }

    if (command.size() > 2 && command[0] == '-' && std::isspace(static_cast<unsigned char>(command[1]))) {
        if (filtro) {
            throw std::invalid_argument("Filtro sillabico: i comandi di modifica non sono ammessi");
        }
        const std::string word = normalizza_testo(command.substr(2));
        if (sola_lettura_) {
            return {messaggio_comando(
                "sola_lettura",
                "Il vocabolario originale e' in sola lettura. Crea o usa un vocabolario personale per modificarlo.",
                word,
                false,
                false), {}, false};
        }
        const bool removed = rimuovi_parola(word);
        return {messaggio_comando(
            "rimozione",
            word + (removed ? " rimossa dal vocabolario." : " non trovata."),
            word,
            removed,
            true), {}, false};
    }

    auto search = dettaglio::esegui_ricerca_indicizzata(vocabulary_, command, runtime_sillabe(), filtro,
        profilo_sillabe_ ? &*profilo_sillabe_ : nullptr);

    PreparazioneComando result;
    result.metadati.tipo = "ricerca";
    result.metadati.footer = std::move(search.footer);
    result.candidati = std::move(search.candidati);
    result.paginabile = search.paginabile;
    return result;
}

RisultatoComando MotoreAnagrammi::esegui_comando_impl(
    const std::string& command, const FiltroSillabe* filtro) {
    auto preparazione = prepara_comando(command, filtro);
    auto& result = preparazione.metadati;
    result.righe = dettaglio::formatta_anagrammi(vocabulary_, preparazione.candidati);
    result.parole_vocabolario.reserve(preparazione.candidati.size());
    for (const auto& candidato : preparazione.candidati) {
        result.parole_vocabolario.push_back(vocabulary_.at(candidato.indice_vocabolario));
    }
    return std::move(result);
}

SintesiRisultato MotoreAnagrammi::avvia_comando_paginato(const std::string& command) {
    return avvia_comando_paginato_impl(command, nullptr);
}

SintesiRisultato MotoreAnagrammi::avvia_comando_paginato_con_filtro_sillabe(
    const std::string& command, const FiltroSillabe& filtro) {
    return avvia_comando_paginato_impl(command, &filtro);
}

SintesiRisultato MotoreAnagrammi::avvia_comando_paginato_impl(
    const std::string& command, const FiltroSillabe* filtro) {
    auto preparazione = prepara_comando(command, filtro);
    const auto& metadati = preparazione.metadati;
    SintesiRisultato sintesi;
    sintesi.tipo = metadati.tipo;
    sintesi.footer = metadati.footer;
    sintesi.messaggio = metadati.messaggio;
    sintesi.parola_modificata = metadati.parola_modificata;
    sintesi.vocabolario_modificato = metadati.vocabolario_modificato;
    sintesi.richiede_salvataggio = metadati.richiede_salvataggio;
    if (!preparazione.paginabile) {
        return sintesi;
    }
    if (ultimo_id_snapshot_ == std::numeric_limits<std::uint32_t>::max()) {
        throw std::overflow_error("Snapshot risultato: identificatori esauriti");
    }
    sintesi.id_snapshot = ultimo_id_snapshot_ + 1;
    sintesi.ha_snapshot = true;
    sintesi.totale = preparazione.candidati.size();
    // Solo move non fallibili dopo la costruzione completa dei metadata pubblici.
    snapshot_.emplace(SnapshotRisultato{sintesi.id_snapshot, std::move(preparazione)});
    ultimo_id_snapshot_ = sintesi.id_snapshot;
    return sintesi;
}

PaginaRisultato MotoreAnagrammi::leggi_pagina_risultato(
    std::uint32_t id, std::size_t offset, std::size_t limite) const {
    if (!snapshot_ || snapshot_->id != id) {
        throw std::logic_error("Snapshot risultato assente o identificatore obsoleto");
    }
    PaginaRisultato pagina;
    pagina.id_snapshot = id;
    pagina.offset = offset;
    const auto& candidati = snapshot_->risultato.candidati;
    if (offset >= candidati.size() || limite == 0) {
        return pagina;
    }
    pagina.count = std::min(limite, candidati.size() - offset);
    // Copia limitata alla pagina: riusa il formatter storico senza duplicarne la logica.
    const dettaglio::CandidatiRicerca selezionati(
        candidati.begin() + offset, candidati.begin() + offset + pagina.count);
    pagina.righe = dettaglio::formatta_anagrammi(vocabulary_, selezionati);
    pagina.parole_vocabolario.reserve(pagina.count);
    for (const auto& candidato : selezionati) {
        pagina.parole_vocabolario.push_back(vocabulary_.at(candidato.indice_vocabolario));
    }
    return pagina;
}

void MotoreAnagrammi::libera_risultato(std::uint32_t id) noexcept {
    if (snapshot_ && snapshot_->id == id) {
        snapshot_.reset();
    }
}

std::string MotoreAnagrammi::esegui_comando_testo(const std::string& command) {
    return risultato_in_testo(esegui_comando(command));
}

std::string risultato_in_testo(const RisultatoComando& result) {
    if (!result.messaggio.empty()) {
        return result.messaggio;
    }

    std::ostringstream output;
    for (const auto& row : result.righe) {
        output << row << '\n';
    }
    output << result.footer;
    return output.str();
}

} // namespace anagrammi
