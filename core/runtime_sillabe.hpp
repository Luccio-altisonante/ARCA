#ifndef ANAGRAMMI_RUNTIME_SILLABE_HPP
#define ANAGRAMMI_RUNTIME_SILLABE_HPP

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace anagrammi {

enum class StatoSillabico : std::uint8_t {
    risolto = 1, stima_corroborata = 2, solo_stima = 3, conflitto = 4,
    da_rivedere = 5, ambiguo = 6, escludi = 7
};

enum class OrigineSillabica : std::uint8_t { automatico = 1, curatela_ufficiale = 2 };

struct VoceSillabica {
    std::vector<std::uint32_t> conteggi;
    StatoSillabico stato;
    OrigineSillabica origine;
    std::uint32_t algoritmo;

    bool esclusione_in_attesa() const { return stato == StatoSillabico::escludi; }
};

struct VerificheRuntimeSillabe {
    std::optional<std::string> vocabolario_sha256;
    std::optional<std::string> annotazioni_sha256;
    std::optional<std::uint64_t> numero_grafie;
    std::optional<std::string> artifact_sha256;
};

class FiltroSillabe {
public:
    // Estremi non uint32 positivi o invertiti: std::invalid_argument.
    static FiltroSillabe esattamente(std::uint64_t numero);
    static FiltroSillabe almeno(std::uint64_t numero);
    static FiltroSillabe al_massimo(std::uint64_t numero);
    static FiltroSillabe tra(std::uint64_t minimo, std::uint64_t massimo);

    std::uint32_t minimo() const { return minimo_; }
    std::uint32_t massimo() const { return massimo_; }

private:
    FiltroSillabe(std::uint64_t minimo, std::uint64_t massimo);
    std::uint32_t minimo_;
    std::uint32_t massimo_;
};

class RuntimeSillabe {
public:
    // Possiede i byte. Buffer/formato/hash invalidi: std::invalid_argument.
    explicit RuntimeSillabe(std::vector<std::uint8_t> bytes,
                           const VerificheRuntimeSillabe& verifiche = {});

    std::uint32_t numero_grafie() const { return numero_grafie_; }
    std::uint32_t numero_conteggi_distinti() const;
    std::uint32_t numero_membership() const { return numero_membership_; }
    const std::string& vocabolario_sha256() const { return vocabolario_sha256_; }
    const std::string& annotazioni_sha256() const { return annotazioni_sha256_; }

    // Indice fuori range: std::out_of_range. Numero non uint32 positivo: std::invalid_argument.
    bool compatibile(std::size_t indice, std::uint64_t numero_sillabe) const;
    std::vector<std::size_t> indici_compatibili(std::uint64_t numero_sillabe) const;
    // Compatibilita: almeno un conteggio finale soddisfa il filtro, indipendentemente dallo stato.
    bool compatibile(std::size_t indice, const FiltroSillabe& filtro) const;
    std::vector<std::size_t> indici_compatibili(const FiltroSillabe& filtro) const;
    VoceSillabica voce(std::size_t indice) const;

private:
    struct Colonna {
        std::uint32_t conteggio;
        std::uint32_t popolazione;
        std::size_t offset;
    };

    std::vector<std::uint8_t> bytes_;
    std::vector<Colonna> colonne_;
    std::uint32_t numero_grafie_ = 0;
    std::uint32_t numero_membership_ = 0;
    std::size_t stride_ = 0;
    std::string vocabolario_sha256_;
    std::string annotazioni_sha256_;

    void verifica_indice(std::size_t indice) const;
    std::size_t cerca_colonna(std::uint64_t numero_sillabe) const;
    std::pair<std::size_t, std::size_t> colonne_per_filtro(const FiltroSillabe& filtro) const;
};

} // namespace anagrammi

#endif
