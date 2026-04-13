import process from 'process';
import fs from "fs";
import path from "path";

let app_data = JSON.parse(process.argv[2]);
let app_path = path.resolve(process.cwd(), "..");
let target_directory_map = {
    "vite.config.js.tpl": path.join(app_path, "frontend"),
    "router.ts.tpl": path.join(app_path, "frontend", "src"),
    "package.json.tpl": app_path,
    "Home.vue.tpl": path.join(app_path, "frontend", "src", "pages"),
};

function replaceTemplate(file_path, data) {
    const template = fs.readFileSync(file_path, "utf-8");

    return template.replace(/\$(\w+)/g, (match, key) => {
        if (!(key in data)) {
            throw new Error(`Missing value for template key: ${key}`);
        }
        return data[key];
    });
}

let boilerplate_folder = path.join(app_path, "frontend", "boilerplate");

fs.readdirSync(boilerplate_folder).forEach(file => {
    let file_path = path.join(boilerplate_folder, file);
    
    // Skip if it's a directory
    if (fs.statSync(file_path).isDirectory()) {
        return;
    }
    
    try {
        let content = fs.readFileSync(file_path, 'utf8');
        let replaced_content = replaceTemplate(file_path, app_data);
        let target_directory = target_directory_map[file];
        
        if (!target_directory) {
            console.warn(`No target directory mapping for: ${file}`);
            return;
        }
        
        // Create directory if it doesn't exist
        let dir = path.dirname(target_directory);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        let output_file = path.join(target_directory, file.replace('.tpl', ''));
        fs.writeFileSync(output_file, replaced_content);
    } catch (err) {
        console.error(`Error processing ${file}:`, err);
    }
});

fs.rmSync(boilerplate_folder, { recursive: true, force: true });