#include "vocabolario_file.hpp"

#include "../core/testo.hpp"

#include <fstream>
#include <stdexcept>

namespace anagrammi_console {

anagrammi::Words carica_vocabolario_da_file(const std::string& path) {
    std::ifstream file(path);
    anagrammi::Words words;
    std::string line;

    while (std::getline(file, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        line = anagrammi::normalizza_testo(line);
        if (!line.empty()) {
            words.push_back(line);
        }
    }

    return words;
}

void salva_vocabolario_su_file(const std::string& path, const anagrammi::Words& words) {
    std::ofstream file(path, std::ios::trunc);
    if (!file) {
        throw std::runtime_error("Impossibile salvare " + path);
    }

    for (const auto& word : words) {
        file << word << '\n';
    }
}

} // namespace anagrammi_console
