#ifndef ANAGRAMMI_API_HPP
#define ANAGRAMMI_API_HPP

#include "vocabolario.hpp"
#include "runtime_sillabe.hpp"
#include "anagrammi_indicizzati.hpp"
#include "profilo_sillabe.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace anagrammi {

// Identita' dei byte sorgente, non attestazione di ufficialita'.
struct VocabolarioConIdentita {
    Words parole;
    std::string sha256;
};

// Conserva l'ordine ricevuto, senza verificarlo o riordinarlo.
// Input non canonico (BOM incluso): std::invalid_argument.
VocabolarioConIdentita carica_vocabolario_ordinato_con_identita(std::string_view bytes);

struct RisultatoComando {
    std::string tipo;
    Words righe;
    Words parole_vocabolario;
    std::string footer;
    std::string messaggio;
    std::string parola_modificata;
    bool vocabolario_modificato = false;
    bool richiede_salvataggio = false;
};

struct SintesiRisultato {
    std::uint32_t id_snapshot = 0;
    bool ha_snapshot = false;
    std::size_t totale = 0;
    std::string tipo;
    std::string footer;
    std::string messaggio;
    std::string parola_modificata;
    bool vocabolario_modificato = false;
    bool richiede_salvataggio = false;
};

struct PaginaRisultato {
    std::uint32_t id_snapshot = 0;
    std::size_t offset = 0;
    std::size_t count = 0;
    Words righe;
    Words parole_vocabolario;
};

class MotoreAnagrammi {
public:
    MotoreAnagrammi() = default;
    explicit MotoreAnagrammi(Words vocabulary);
    // La cache paginata non viene ereditata da copie o spostamenti.
    MotoreAnagrammi(const MotoreAnagrammi& altro);
    MotoreAnagrammi& operator=(const MotoreAnagrammi& altro);
    MotoreAnagrammi(MotoreAnagrammi&& altro) noexcept;
    MotoreAnagrammi& operator=(MotoreAnagrammi&& altro) noexcept;

    void sostituisci_vocabolario(Words vocabulary);
    // Normalizza e ordina testo arbitrario con il rimario condiviso.
    void carica_vocabolario_da_testo(const std::string& text);
    // Normalizza testo gia' ordinato, senza ripetere l'ordinamento.
    void carica_vocabolario_ordinato_da_testo(const std::string& text);
    // Verifica i byte sorgente; errore: nessuna modifica allo stato precedente.
    void carica_vocabolario_ordinato_con_identita(std::string_view bytes);
    // Compatibilita' dello snapshot, non autenticazione dell'artifact.
    // Identita' assente, hash o cardinalita' diversi: std::invalid_argument.
    void associa_runtime_sillabe(RuntimeSillabe runtime);
    const std::optional<std::string>& identita_vocabolario_sha256() const noexcept;
    bool ha_runtime_sillabe() const noexcept;
    // nullptr se assente; il puntatore e' valido fino alla prossima mutazione.
    const RuntimeSillabe* runtime_sillabe() const noexcept;
    // Profilo distinto dal runtime: stima per grafie sconosciute, dati ufficiali dove presenti.
    void prepara_sillabe_personali();
    void prepara_sillabe_personali_da_ufficiale(const MotoreAnagrammi& ufficiale);
    bool ha_profilo_sillabe_personale() const noexcept;
    void applica_modifiche(const Words& parole_rimosse, const Words& parole_aggiunte);

    const Words& vocabolario() const;
    std::size_t numero_parole() const;
    std::string esporta_vocabolario_testo() const;

    void imposta_sola_lettura(bool sola_lettura);
    bool sola_lettura() const;

    bool aggiungi_parola(const std::string& word);
    bool rimuovi_parola(const std::string& word);

    // Solo anagrammi: normalizza la parola, senza interpretare comandi testuali.
    // Il filtro vale per questa chiamata; runtime e profilo assenti: std::logic_error.
    Words cerca_anagrammi_con_filtro_sillabe(
        const std::string& parola, std::size_t lunghezza, const FiltroSillabe& filtro) const;

    RisultatoComando esegui_comando(const std::string& command);
    // Filtro per chiamata sulle ricerche lessicali; + / - rifiutati prima di mutare.
    // Runtime e profilo assenti: std::logic_error; modifica con filtro: std::invalid_argument.
    RisultatoComando esegui_comando_con_filtro_sillabe(
        const std::string& command, const FiltroSillabe& filtro);
    std::string esegui_comando_testo(const std::string& command);

    // Ogni comando, anche storico o fallito, invalida lo snapshot precedente.
    // Una ricerca valida senza corrispondenze ha comunque uno snapshot vuoto.
    SintesiRisultato avvia_comando_paginato(const std::string& command);
    SintesiRisultato avvia_comando_paginato_con_filtro_sillabe(
        const std::string& command, const FiltroSillabe& filtro);
    // Snapshot assente o ID obsoleto: std::logic_error. Nessuna nuova ricerca.
    PaginaRisultato leggi_pagina_risultato(
        std::uint32_t id, std::size_t offset, std::size_t limite) const;
    // ID obsoleto/assente: no-op; non puo' liberare un risultato piu' recente.
    void libera_risultato(std::uint32_t id) noexcept;

private:
    struct PreparazioneComando {
        RisultatoComando metadati;
        dettaglio::CandidatiRicerca candidati;
        bool paginabile = false;
    };

    struct SnapshotRisultato {
        std::uint32_t id;
        PreparazioneComando risultato;
    };

    Words vocabulary_;
    std::optional<std::string> identita_vocabolario_sha256_;
    std::optional<RuntimeSillabe> runtime_sillabe_;
    mutable std::shared_ptr<const FonteSillabeUfficiali> fonte_sillabe_;
    std::optional<ProfiloSillabePersonale> profilo_sillabe_;
    bool sola_lettura_ = false;
    bool ordinato_rimario_ = false;
    std::optional<SnapshotRisultato> snapshot_;
    // Contatore locale all'oggetto: non viene copiato, spostato o azzerato.
    std::uint32_t ultimo_id_snapshot_ = 0;

    void invalida_identita_e_runtime() noexcept;
    void scambia_stato(MotoreAnagrammi& altro) noexcept;
    PreparazioneComando prepara_comando(const std::string& command, const FiltroSillabe* filtro);
    RisultatoComando esegui_comando_impl(const std::string& command, const FiltroSillabe* filtro);
    SintesiRisultato avvia_comando_paginato_impl(const std::string& command, const FiltroSillabe* filtro);
};

std::string risultato_in_testo(const RisultatoComando& result);

} // namespace anagrammi

#endif
