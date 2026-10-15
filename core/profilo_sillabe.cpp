#include "profilo_sillabe.hpp"
#include "sha256.hpp"
#include "sillabe.hpp"
#include <algorithm>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <utility>

namespace anagrammi {
namespace { constexpr auto sconosciuta = std::numeric_limits<std::uint32_t>::max(); }

std::uint32_t dettaglio::codifica_stima_sillabe(std::size_t stima) {
    if (stima >= sconosciuta) throw std::overflow_error("Stima sillabica fuori range");
    return static_cast<std::uint32_t>(stima);
}

FonteSillabeUfficiali::FonteSillabeUfficiali(const Words& words, const RuntimeSillabe& dati)
    : parole(words), runtime(dati) {
    std::string bytes;
    for (const auto& parola : parole) { bytes += parola; bytes += '\n'; }
    if (parole.size() != runtime.numero_grafie() ||
        dettaglio::sha256_esadecimale(dettaglio::sha256(
            reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size())) != runtime.vocabolario_sha256()) {
        throw std::invalid_argument("Fonte sillabica: identita' del vocabolario incompatibile");
    }
    indici_per_grafia.resize(parole.size());
    std::iota(indici_per_grafia.begin(), indici_per_grafia.end(), 0u);
    std::sort(indici_per_grafia.begin(), indici_per_grafia.end(), [&](auto a, auto b) {
        return parole[a] != parole[b] ? parole[a] < parole[b] : a < b;
    });
}

ProfiloSillabePersonale::ProfiloSillabePersonale(const Words& parole,
    std::shared_ptr<const FonteSillabeUfficiali> fonte) : fonte_(std::move(fonte)) {
    voci_.reserve(parole.size());
    for (const auto& parola : parole) {
        voci_.push_back(crea_voce(parola));
    }
}

ProfiloSillabePersonale::Voce ProfiloSillabePersonale::crea_voce(const std::string& parola) const {
    if (fonte_) {
        const auto& indici = fonte_->indici_per_grafia;
        const auto found = std::lower_bound(indici.begin(), indici.end(), parola,
            [&](auto i, const auto& word) { return fonte_->parole[i] < word; });
        if (found != indici.end() && fonte_->parole[*found] == parola) {
            return {static_cast<std::uint32_t>(found - indici.begin()), 0};
        }
    }
    return {sconosciuta, dettaglio::codifica_stima_sillabe(conta_sillabe(parola))};
}

void ProfiloSillabePersonale::inserisci(std::size_t indice, const std::string& parola) {
    if (indice > voci_.size()) throw std::out_of_range("Indice profilo sillabico fuori range");
    const auto voce = crea_voce(parola);
    voci_.insert(voci_.begin() + indice, voce);
}

void ProfiloSillabePersonale::rimuovi(std::size_t indice) noexcept {
    voci_.erase(voci_.begin() + indice);
}

void ProfiloSillabePersonale::riordina(const std::vector<std::size_t>& indici) {
    std::vector<Voce> ordinate;
    ordinate.reserve(indici.size());
    for (auto i : indici) ordinate.push_back(voci_.at(i));
    voci_.swap(ordinate);
}

bool ProfiloSillabePersonale::compatibile(std::size_t indice, const FiltroSillabe& filtro) const {
    const auto& voce = voci_.at(indice);
    if (voce.posizione_grafia != sconosciuta) {
        const auto& indici = fonte_->indici_per_grafia;
        const auto& parola = fonte_->parole[indici[voce.posizione_grafia]];
        // Grafie duplicate nella fonte: unione dei conteggi, mai duplicazione dei candidati.
        for (std::size_t j = voce.posizione_grafia; j < indici.size() && fonte_->parole[indici[j]] == parola; ++j) {
            if (fonte_->runtime.compatibile(indici[j], filtro)) return true;
        }
        return false;
    }
    return voce.stima > 0 && voce.stima >= filtro.minimo() && voce.stima <= filtro.massimo();
}
} // namespace anagrammi
