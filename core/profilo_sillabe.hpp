#ifndef ANAGRAMMI_PROFILO_SILLABE_HPP
#define ANAGRAMMI_PROFILO_SILLABE_HPP

#include "runtime_sillabe.hpp"
#include "vocabolario.hpp"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace anagrammi {

namespace dettaglio {
std::uint32_t codifica_stima_sillabe(std::size_t stima);
}

// Snapshot separato: gli indici del runtime restano quelli del suo vocabolario.
struct FonteSillabeUfficiali {
    Words parole;
    RuntimeSillabe runtime;
    std::vector<std::uint32_t> indici_per_grafia;
    FonteSillabeUfficiali(const Words& parole, const RuntimeSillabe& runtime);
};

class ProfiloSillabePersonale {
public:
    ProfiloSillabePersonale(const Words& parole,
        std::shared_ptr<const FonteSillabeUfficiali> fonte = nullptr);
    bool compatibile(std::size_t indice, const FiltroSillabe& filtro) const;
    // Inserimento: strong guarantee. Rimozione: indice valido, nessuna allocazione.
    void inserisci(std::size_t indice, const std::string& parola);
    void rimuovi(std::size_t indice) noexcept;
    void riordina(const std::vector<std::size_t>& indici);
    const std::shared_ptr<const FonteSillabeUfficiali>& fonte() const { return fonte_; }

private:
    struct Voce { std::uint32_t posizione_grafia; std::uint32_t stima; };
    std::shared_ptr<const FonteSillabeUfficiali> fonte_;
    std::vector<Voce> voci_;
    Voce crea_voce(const std::string& parola) const;
};

} // namespace anagrammi
#endif
